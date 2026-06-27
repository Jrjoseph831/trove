import * as path from "path";
import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
  CfnOutput,
} from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cognito from "aws-cdk-lib/aws-cognito";
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import type { Construct } from "constructs";

/** OAuth redirect targets — Vercel (primary), GitHub Pages, and local dev. */
const CALLBACK_URLS = [
  "https://trove.ceo/",
  "https://www.trove.ceo/",
  "https://beta.trove.ceo/",
  "https://troveworld.tech/",
  "https://www.troveworld.tech/",
  "https://troveworld.fun/",
  "https://www.troveworld.fun/",
  "https://trove-web-beta.vercel.app/",
  "https://jrjoseph831.github.io/trove/",
  "http://localhost:3000/",
];

/** Where the Lambda handler sources live (@trove/server). */
const HANDLERS = path.join(__dirname, "..", "..", "packages", "server", "src", "handlers");

/** Origins allowed to call the API (Vercel primary, Pages, local dev). */
const ALLOWED_ORIGINS = [
  "https://trove.ceo",
  "https://www.trove.ceo",
  "https://beta.trove.ceo",
  "https://troveworld.fun",
  "https://troveworld.tech",
  "https://trove-web-beta.vercel.app",
  "https://jrjoseph831.github.io",
  "http://localhost:3000",
];

export interface TroveStackProps extends StackProps {
  /** "prod" (default) = the live world: prod table/api names + its own Cognito.
   *  Any other value = an ISOLATED env (e.g. "staging"): prefixed table/api
   *  names AND it reuses the prod Cognito pool (via authPool/authClient) instead
   *  of creating its own — so the same login works while the world/data is
   *  fully separate. `beta` deploys only the staging stack, so prod is untouched. */
  stage?: string;
  /** Existing Cognito user-pool id to reuse for the authorizer (non-prod only). */
  authPool?: string;
  /** Existing Cognito app-client id to accept as JWT audience (non-prod only). */
  authClient?: string;
}

export class TroveStack extends Stack {
  constructor(scope: Construct, id: string, props?: TroveStackProps) {
    super(scope, id, props);

    const stage = props?.stage ?? "prod";
    const isProd = stage === "prod";
    // Resource name prefix: prod keeps the existing "trove-*" names exactly (so
    // the live tables are never renamed/replaced); other stages get "trove-<stage>-*".
    const pfx = isProd ? "trove" : `trove-${stage}`;
    // Prod data is sacred (RETAIN); a staging world is disposable, so it tears
    // down cleanly (DESTROY) instead of orphaning tables on a failed/rolled-back
    // deploy.
    const retain = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // ── DynamoDB ────────────────────────────────────────────────────────────
    // The one Live world (singleton document) + per-player tables (used from
    // Stage C onward; created now so the schema is stable).
    const market = new dynamodb.Table(this, "Market", {
      tableName: `${pfx}-market`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retain, // prod never drops the world; staging is disposable
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const players = new dynamodb.Table(this, "Players", {
      tableName: `${pfx}-players`,
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retain,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const ownership = new dynamodb.Table(this, "Ownership", {
      tableName: `${pfx}-ownership`,
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "itemId", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retain,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // Player-to-player orders (multiplayer routing). Queried by both sides via
    // GSIs on sellerId (a desk's incoming) and buyerId (a player's outgoing).
    const orders = new dynamodb.Table(this, "Orders", {
      tableName: `${pfx}-orders`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: retain,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    orders.addGlobalSecondaryIndex({
      indexName: "sellerId-index",
      partitionKey: { name: "sellerId", type: dynamodb.AttributeType.STRING },
    });
    orders.addGlobalSecondaryIndex({
      indexName: "buyerId-index",
      partitionKey: { name: "buyerId", type: dynamodb.AttributeType.STRING },
    });

    // ── Lambda factory ──────────────────────────────────────────────────────
    const fn = (name: string, entry: string, timeout = Duration.seconds(30)) =>
      new lambdaNode.NodejsFunction(this, name, {
        entry: path.join(HANDLERS, entry),
        handler: "handler",
        runtime: Runtime.NODEJS_20_X,
        timeout,
        memorySize: 512,
        environment: {
          MARKET_TABLE: market.tableName,
          PLAYERS_TABLE: players.tableName,
          OWNERSHIP_TABLE: ownership.tableName,
          ORDERS_TABLE: orders.tableName,
        },
        bundling: {
          // CommonJS output: the AWS SDK (CJS) does `require("node:https")` at
          // runtime, which an ESM bundle can't satisfy. esbuild transpiles our
          // ESM engine/data into CJS cleanly.
          format: lambdaNode.OutputFormat.CJS,
          target: "node20",
          // bundle everything (incl. aws-sdk v3) for reproducible deploys
          externalModules: [],
          // JSON catalog imports from @trove/data
          loader: { ".json": "json" },
        },
      });

    // ── Settlement: the 6h MARKET heartbeat (prices/news only) ──────────────
    const settlement = fn("Settlement", "settlement.ts");
    market.grantReadWriteData(settlement);

    new events.Rule(this, "SettlementClock", {
      // UTC 6h marks — the same beats the newsroom cron fires on
      schedule: events.Schedule.cron({ minute: "0", hour: "0,6,12,18" }),
      targets: [new targets.LambdaFunction(settlement)],
      description: "Settle the Trove market every 6 hours (00/06/12/18 UTC).",
    });

    // ── Production: the FAST factory clock (decoupled from the market) ───────
    // Every few minutes it advances each player's factories (a batch per ~5min
    // production tick), runs Auto-Fulfill, and files reports per 6h flip. Reads
    // the market, reads+writes players, and writes produced holdings to the
    // world doc — all committed atomically under the world version.
    const production = fn("Production", "production.ts", Duration.seconds(60));
    market.grantReadWriteData(production);
    players.grantReadWriteData(production);

    new events.Rule(this, "ProductionClock", {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(production)],
      description: "Run player factory production every 5 minutes (live floor).",
    });

    // ── Read API (public, anonymous) ────────────────────────────────────────
    const read = fn("Read", "read.ts", Duration.seconds(10));
    market.grantReadWriteData(read); // may seed the world on first call

    const api = new HttpApi(this, "Api", {
      apiName: `${pfx}-public`,
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        // POST is needed for /trade; authorization carries the Cognito token.
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["content-type", "authorization"],
        maxAge: Duration.hours(1),
      },
    });
    api.addRoutes({
      path: "/world",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("ReadIntegration", read),
    });

    // ── Auth: Cognito (the Acquire gate) ────────────────────────────────────
    // Browsing is anonymous; signing in is required only to trade. Email is
    // built in; Google federation turns on if google client creds are supplied
    // via context (-c googleClientId=… -c googleClientSecret=…).
    //
    // Non-prod stages (staging) DON'T create their own pool — they reuse the prod
    // pool (authPool/authClient) so the same login works while the world is
    // separate. This also avoids minting duplicate Cognito/Google resources.
    let issuer: string;
    let audience: string;
    if (!isProd) {
      if (!props?.authPool || !props?.authClient) {
        throw new Error(`stage "${stage}" requires authPool + authClient to reuse`);
      }
      issuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.authPool}`;
      audience = props.authClient;
    } else {
    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "trove-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireDigits: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: retain,
    });

    const supportedIdps = [cognito.UserPoolClientIdentityProvider.COGNITO];
    const googleClientId = this.node.tryGetContext("googleClientId");
    const googleClientSecret = this.node.tryGetContext("googleClientSecret");
    let googleIdp: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (googleClientId && googleClientSecret) {
      googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
        userPool,
        clientId: googleClientId,
        clientSecretValue: SecretValue.unsafePlainText(googleClientSecret),
        scopes: ["openid", "email", "profile"],
        attributeMapping: { email: cognito.ProviderAttribute.GOOGLE_EMAIL },
      });
      supportedIdps.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `trove-${this.account}` },
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "trove-web",
      generateSecret: false, // public SPA client
      supportedIdentityProviders: supportedIdps,
      // Authorization Code + PKCE only. The legacy implicit grant returns tokens
      // in the URL fragment with no refresh token — drop it now that the app uses
      // the code flow, so there's no insecure path left to abuse.
      enableTokenRevocation: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: CALLBACK_URLS,
        logoutUrls: CALLBACK_URLS,
      },
    });
    // Refresh-token rotation: each refresh invalidates the old token and issues a
    // new one, so a stolen refresh token is useful for one cycle instead of the
    // full ~30-day window. The client (auth.ts) stores the rotated token and
    // single-flights refreshes; the grace period covers brief concurrent calls.
    (userPoolClient.node.defaultChild as cognito.CfnUserPoolClient)
      .refreshTokenRotation = {
      feature: "ENABLED",
      retryGracePeriodSeconds: 30,
    };
    // The client lists Google as a provider, so it must be created AFTER the
    // Google IdP exists — otherwise CloudFormation errors "provider Google does
    // not exist". An explicit dependency enforces the order.
    if (googleIdp) userPoolClient.node.addDependency(googleIdp);

    issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    audience = userPoolClient.userPoolClientId;
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    } // end prod-only Cognito

    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", issuer, {
      jwtAudience: [audience],
    });

    // ── Trade + portfolio (authorized) ──────────────────────────────────────
    const trade = fn("Trade", "trade.ts", Duration.seconds(15));
    market.grantReadWriteData(trade);
    players.grantReadWriteData(trade);
    api.addRoutes({
      path: "/trade",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("TradeIntegration", trade),
      authorizer,
    });

    const portfolio = fn("Portfolio", "portfolio.ts", Duration.seconds(10));
    market.grantReadData(portfolio);
    players.grantReadData(portfolio);
    api.addRoutes({
      path: "/portfolio",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("PortfolioIntegration", portfolio),
      authorizer,
    });

    // ── Order Desk (authorized): the PVE contract loop ──────────────────────
    const desk = fn("Desk", "desk.ts", Duration.seconds(15));
    market.grantReadWriteData(desk);
    players.grantReadWriteData(desk);
    api.addRoutes({
      path: "/desk",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: new HttpLambdaIntegration("DeskIntegration", desk),
      authorizer,
    });

    // ── Factory (authorized): the production floor. Pure player-record writes
    //    (lines/infra/listings); produced stock is created by Settlement. ──────
    const factory = fn("Factory", "factory.ts", Duration.seconds(15));
    market.grantReadData(factory);
    players.grantReadWriteData(factory);
    api.addRoutes({
      path: "/factory",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("FactoryIntegration", factory),
      authorizer,
    });

    // ── Company websites: public directory + sites, authorized save ─────────
    const company = fn("Company", "company.ts", Duration.seconds(15));
    market.grantReadData(company);
    players.grantReadWriteData(company);
    api.addRoutes({
      path: "/companies",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("CompaniesIntegration", company),
    });
    api.addRoutes({
      path: "/companies/{handle}",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("CompanyIntegration", company),
    });
    api.addRoutes({
      path: "/houses/{handle}",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("HouseIntegration", company),
    });
    api.addRoutes({
      path: "/site",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("SiteIntegration", company),
      authorizer,
    });

    // ── Player-to-player orders (authorized): multiplayer routing ───────────
    // Settling a deal moves goods (world doc) + cash (both players) atomically,
    // so it reads+writes the market, players, and the orders table.
    const ordersFn = fn("OrdersFn", "orders.ts", Duration.seconds(15));
    market.grantReadWriteData(ordersFn);
    players.grantReadWriteData(ordersFn);
    orders.grantReadWriteData(ordersFn);
    api.addRoutes({
      path: "/orders",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: new HttpLambdaIntegration("OrdersIntegration", ordersFn),
      authorizer,
    });
    api.addRoutes({
      path: "/orders/{id}/action",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("OrderActionIntegration", ordersFn),
      authorizer,
    });

    // ── Standings (public) ──────────────────────────────────────────────────
    const standings = fn("Standings", "standings.ts", Duration.seconds(10));
    market.grantReadData(standings);
    players.grantReadData(standings);
    api.addRoutes({
      path: "/standings",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("StandingsIntegration", standings),
    });

    // ── AI traders (Stage B): keep the floor alive between human trades ──────
    const traders = fn("Traders", "traders.ts", Duration.seconds(20));
    market.grantReadWriteData(traders);
    new events.Rule(this, "TraderClock", {
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(traders)],
      description: "Fire a batch of AI-trader actions every 15 minutes.",
    });

    // ── Seed (manual / first-deploy convenience) ────────────────────────────
    const seed = fn("Seed", "seed.ts", Duration.seconds(20));
    market.grantReadWriteData(seed);

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint,
      description: "API base URL (GET /world, /standings; auth POST /trade, GET /portfolio).",
    });
    // UserPoolId / UserPoolClientId are emitted inside the prod-only Cognito block.
    if (isProd) {
      new CfnOutput(this, "HostedUiDomain", {
        value: `https://trove-${this.account}.auth.${this.region}.amazoncognito.com`,
        description: "Cognito Hosted UI base (sign-in / sign-up).",
      });
    }
    new CfnOutput(this, "SeedFunctionName", {
      value: seed.functionName,
      description: "Invoke once to seed the world (or just hit /world).",
    });
  }
}

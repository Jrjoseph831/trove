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

/** OAuth redirect targets — the live site (basePath /trove) + local dev. */
const CALLBACK_URLS = [
  "https://jrjoseph831.github.io/trove/",
  "http://localhost:3000/",
];

/** Where the Lambda handler sources live (@trove/server). */
const HANDLERS = path.join(__dirname, "..", "..", "packages", "server", "src", "handlers");

/** Origins allowed to read the world (the live site + local dev). */
const ALLOWED_ORIGINS = [
  "https://jrjoseph831.github.io",
  "http://localhost:3000",
];

export class TroveStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── DynamoDB ────────────────────────────────────────────────────────────
    // The one Live world (singleton document) + per-player tables (used from
    // Stage C onward; created now so the schema is stable).
    const market = new dynamodb.Table(this, "Market", {
      tableName: "trove-market",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // never auto-drop the world
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const players = new dynamodb.Table(this, "Players", {
      tableName: "trove-players",
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const ownership = new dynamodb.Table(this, "Ownership", {
      tableName: "trove-ownership",
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "itemId", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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

    // ── Settlement: the 6h heartbeat ────────────────────────────────────────
    const settlement = fn("Settlement", "settlement.ts");
    market.grantReadWriteData(settlement);

    new events.Rule(this, "SettlementClock", {
      // UTC 6h marks — the same beats the newsroom cron fires on
      schedule: events.Schedule.cron({ minute: "0", hour: "0,6,12,18" }),
      targets: [new targets.LambdaFunction(settlement)],
      description: "Settle the Trove world every 6 hours (00/06/12/18 UTC).",
    });

    // ── Read API (public, anonymous) ────────────────────────────────────────
    const read = fn("Read", "read.ts", Duration.seconds(10));
    market.grantReadWriteData(read); // may seed the world on first call

    const api = new HttpApi(this, "Api", {
      apiName: "trove-public",
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.OPTIONS],
        allowHeaders: ["content-type"],
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
    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "trove-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireDigits: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
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
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: CALLBACK_URLS,
        logoutUrls: CALLBACK_URLS,
      },
    });
    // The client lists Google as a provider, so it must be created AFTER the
    // Google IdP exists — otherwise CloudFormation errors "provider Google does
    // not exist". An explicit dependency enforces the order.
    if (googleIdp) userPoolClient.node.addDependency(googleIdp);

    const authorizer = new HttpJwtAuthorizer(
      "JwtAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

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
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "HostedUiDomain", {
      value: `https://trove-${this.account}.auth.${this.region}.amazoncognito.com`,
      description: "Cognito Hosted UI base (sign-in / sign-up).",
    });
    new CfnOutput(this, "SeedFunctionName", {
      value: seed.functionName,
      description: "Invoke once to seed the world (or just hit /world).",
    });
  }
}

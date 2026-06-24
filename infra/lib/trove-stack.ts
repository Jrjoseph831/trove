import * as path from "path";
import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  CfnOutput,
} from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

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

    // ── Seed (manual / first-deploy convenience) ────────────────────────────
    const seed = fn("Seed", "seed.ts", Duration.seconds(20));
    market.grantReadWriteData(seed);

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint,
      description: "Public read API base URL (GET {url}/world).",
    });
    new CfnOutput(this, "SeedFunctionName", {
      value: seed.functionName,
      description: "Invoke once to seed the world (or just hit /world).",
    });
  }
}

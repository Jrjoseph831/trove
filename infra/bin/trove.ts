#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TroveStack } from "../lib/trove-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// Production — the live, streamed world (deployed from `main`).
new TroveStack(app, "TroveShared", {
  env,
  description: "Trove — the shared, server-owned market world.",
});

// Staging — an isolated world for testing (deployed from `beta`). Reuses the
// prod Cognito pool so the same login works, but its data is fully separate.
new TroveStack(app, "TroveStaging", {
  env,
  stage: "staging",
  authPool: "us-east-1_ES1s2w3Kx",
  authClient: "70stuln68g90umttvrfk1k84kk",
  description: "Trove — isolated staging world (beta.trove.ceo).",
});

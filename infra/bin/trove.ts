#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TroveStack } from "../lib/trove-stack";

const app = new cdk.App();

new TroveStack(app, "TroveShared", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Trove — the shared, server-owned market world.",
});

# Trove — AWS shared world (CDK)

The server-owned Live world: DynamoDB + a Settlement Lambda on a 6h EventBridge
clock + a public read API. The Lambdas import `@trove/engine` directly, so the
economy logic has exactly one home (the same `settleCycle` the client sandbox runs).

```
EventBridge (00/06/12/18 UTC) ─▶ Settlement Lambda ─┐
                                                     ├─▶ DynamoDB (trove-market)
Anonymous browser ─▶ API Gateway ─▶ Read Lambda ─────┘
```

## One-time setup (you, in YOUR AWS account)

Everything below uses **AWS CloudShell** (open it from the AWS Console toolbar) so
you never put credentials on your machine. Do these once, in order.

**1. Create the GitHub→AWS deploy role (OIDC, no stored keys).**
In CloudShell, from a checkout of this repo (or upload `infra/bootstrap/github-oidc.yaml`):

```bash
aws cloudformation deploy \
  --template-file infra/bootstrap/github-oidc.yaml \
  --stack-name trove-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM
```

> If the account already has a GitHub OIDC provider, add
> `--parameter-overrides CreateOIDCProvider=false`.

Grab the role ARN it prints:

```bash
aws cloudformation describe-stacks --stack-name trove-github-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
```

**2. Bootstrap CDK** (creates the roles CDK deploys through), once per account+region:

```bash
npx aws-cdk@2 bootstrap aws://<ACCOUNT_ID>/us-east-1
```

**3. Set two GitHub repo variables** (Settings → Secrets and variables → Actions → **Variables**):

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | the role ARN from step 1 |
| `AWS_REGION` | `us-east-1` (or your chosen region) |

**4. Deploy.** Actions → **Deploy AWS (shared world)** → Run workflow. It assumes
the role and runs `cdk deploy`. The run's output prints **`ApiUrl`** — the public
read endpoint. The world seeds itself on the first request to `GET {ApiUrl}/world`.

## After deploy

- **`ApiUrl`** is the base; `GET {ApiUrl}/world` returns the public view (prices,
  the front-page story, archive). Sector demand and news effects are never sent —
  the hidden signal stays server-side.
- Settlement runs automatically every 6h. Force one anytime: Lambda console →
  `TroveShared-Settlement…` → Test (empty event). Seed manually with the `Seed`
  function if ever needed.
- Tables are `RETAIN` + point-in-time recovery — the world survives stack changes.

## Local dev

```bash
npm run typecheck -w @trove/server   # handler/repository types
cd infra && npx cdk synth            # bundles the Lambdas, validates the stack
cd infra && npx cdk diff             # preview a change before pushing
```

Stages: **A** server world + read path (this) → **B** server-side AI traders →
**C** Cognito auth + Trade Lambda (the Acquire gate) → **D** client cutover.

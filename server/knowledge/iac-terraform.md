# Infrastructure as Code with Terraform on Azure

## Why Terraform instead of the Azure Portal

The portal is excellent for exploring a service and for one-off investigation, but
clicking through it leaves no record of *what* was created or *why*. Terraform turns the
environment into a file that lives in source control.

- **Reviewable** — an infrastructure change arrives as a pull request. A colleague can see
  the diff before anything touches production.
- **Repeatable** — the same code builds dev, test and production identically. New
  environments take minutes instead of a day of clicking.
- **Previewable** — `terraform plan` shows exactly what will be added, changed or
  destroyed before you approve it. The portal has no equivalent dry run.
- **Drift detection** — if someone changes a setting by hand, the next plan surfaces it.
- **Recoverable** — rebuilding a deleted resource group is re-running the code, not
  reconstructing it from memory or screenshots.
- **One workflow** — the same tool and process covers Azure and, if it ever matters,
  other clouds and SaaS providers.

The usual pattern is portal for learning, Terraform for anything that must exist tomorrow.

## Terraform vs Bicep vs ARM templates

- **ARM templates** — JSON, native to Azure, verbose. Mostly a compilation target now.
- **Bicep** — Microsoft's Azure-only language over ARM. Excellent Azure coverage, day-one
  support for new resources, no state file to manage, free.
- **Terraform** — HashiCorp's multi-cloud tool. Larger ecosystem, manages non-Azure
  resources such as GitHub, Entra ID, Datadog or Cloudflare in the same workflow, and has
  an explicit state file that enables drift detection and planning.

Choose Bicep for an Azure-only team already deep in Microsoft tooling. Choose Terraform for
multi-cloud estates or where the team already knows it. Both are valid; the wrong answer is
neither.

## The state file

Terraform records what it manages in a state file. Store it in an Azure Storage account
with versioning and locking enabled, never in Git — it can contain secrets. Blob leases
prevent two engineers applying at once.

## Common objections

- *"It's another language to learn."* HCL is small; most teams are productive within days,
  and the review process it enables pays for itself the first time a change is caught.
- *"We move too fast for reviews."* Plan output makes reviews faster, not slower, because
  the reviewer sees the exact effect rather than guessing.
- *"We already have scripts."* Scripts describe steps and must handle every prior state.
  Terraform describes the desired end state and works out the steps.

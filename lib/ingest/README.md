# Topic research — owner: Dust-OP (A)

`POST /api/research` replaces the mock route with bounded public-source acquisition,
passage selection and source-bound YES/NO evidence cards for the existing debate
engine. Missing evidence returns empty cards and explicit diagnostics.

See [RESEARCH.md](RESEARCH.md) for the request, provider configuration, supported
source coverage and API/test instructions. The backend has no preview UI dependency.
The current courtroom uses EvidenceCard[], not the former numeric DataPoint model.

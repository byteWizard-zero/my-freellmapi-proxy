# Agent Guidelines for FreeLLMAPI

## README Documentation Rule

Whenever you make updates, additions, or modifications to code (features, endpoints, provider adapters, configuration, UI components, or capabilities):

1. **Evaluate Documentation Impact**:
   - Check if the change introduces new endpoints, modifies request/response payloads, adds new providers, alters configuration / environment variables, or adds user-facing capabilities (such as new UI tabs, tools, or workflows).

2. **Update `README.md` if Required**:
   - Keep `README.md` strictly synchronized with the codebase. Update the supported features list, provider matrix, API usage examples (cURL / Python SDK snippets), configuration guides, or table of contents whenever relevant.

3. **Exclusions**:
   - **Bug fixes, typo corrections, performance optimizations, and internal refactors** that do not alter the public endpoints, features, or external behavior do **not** require updates to `README.md`.

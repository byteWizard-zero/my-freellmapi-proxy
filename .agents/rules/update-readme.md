---
name: update-readme
description: Enforce updating README.md whenever new features, endpoints, providers, or architectural changes are introduced in code (excluding internal bug fixes/refactors).
---

# README Synchronization Rule

## Directive
Whenever you make updates, additions, or modifications to the codebase (features, endpoints, providers, configuration, UI components, or capabilities):

1. **Evaluate Documentation Impact**:
   - Assess whether the change introduces new endpoints, modifies request/response payloads, adds new provider capabilities, alters configuration or environment variables, or adds user-facing features (such as new UI tabs, CLI tools, or workflows).

2. **Update `README.md`**:
   - If the changes alter or expand any functionality, update `README.md` to reflect them accurately (supported features, provider matrix, API usage examples with cURL/SDK snippets, configuration instructions, or screenshots/descriptions).
   - Ensure tables, feature lists, and code examples in `README.md` remain strictly in sync with the codebase.

3. **Exclusions**:
   - **Bug fixes, typo corrections, performance optimizations, and internal non-breaking refactors** that do not alter the external behavior, endpoints, features, or public contract do NOT require updating `README.md`.

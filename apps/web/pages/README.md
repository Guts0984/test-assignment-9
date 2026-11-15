Intentionally empty.

Feature-Sliced Design has a `pages` layer, and Next.js treats a top-level `pages/` folder as the legacy
Pages Router. This placeholder at the project root makes Next ignore `src/pages` (our FSD layer)
for routing; the real routes live in `app/` and only re-export from `src/pages`.

// ---------------------------------------------------------------------------
// vite.config.js
//
// `base` matches this project's GitHub Pages URL path. GitHub Pages serves
// a project repo (as opposed to a <username>.github.io user/org site) from
// https://<username>.github.io/<repo-name>/, so every built asset URL needs
// that repo name as a prefix - without it, the built index.html looks for
// its scripts/styles at the domain root and 404s.
//
// If this repo is ever renamed, update the path below (and the workflow
// in .github/workflows/deploy.yml doesn't need to change - it just builds
// whatever this config says).
// ---------------------------------------------------------------------------
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pointsource-dashboard/',
});

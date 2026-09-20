import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
// Render the real components through React SSR, without a browser or backend.
const compiled = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import PublicTerms from './src/PublicTerms.jsx';
      import TermsConsent from './src/components/TermsConsent.jsx';
      export const terms = renderToStaticMarkup(<PublicTerms />);
      export const unchecked = renderToStaticMarkup(<TermsConsent checked={false} onChange={() => {}} />);
      export const checked = renderToStaticMarkup(<TermsConsent checked={true} onChange={() => {}} />);`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  banner: { js: `import {createRequire} from 'node:module'; const require = createRequire(${JSON.stringify(fileURLToPath(new URL('../../package.json', import.meta.url)))});` },
});
const rendered = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('Terms and Privacy render as separate named links with clear interactive styling', () => {
  assert.match(rendered.unchecked, /<a href="https:\/\/imbored.au\/terms"[^>]*>Terms of Use<\/a>/);
  assert.match(rendered.unchecked, /<a href="https:\/\/imbored.au\/privacy"[^>]*>Privacy Policy<\/a>/);
  assert.match(rendered.unchecked, /\.terms-consent__sentence a \{[^}]*color:var\(--color-primary\);[^}]*font-weight:700;[^}]*border-bottom:1\.5px solid/);
  assert.match(rendered.unchecked, /\.terms-consent__sentence a:focus-visible,[^}]*\.terms-consent__checkbox input:focus-visible \{[^}]*outline:3px solid/);
  assert.doesNotMatch(rendered.unchecked, /<label[^>]*>[^<]*<a/);
});

test('checkbox has a complete accessible label and remains controlled without default acceptance', () => {
  assert.match(rendered.unchecked, /type="checkbox" aria-label="I agree to the Terms of Use and Privacy Policy"/);
  assert.doesNotMatch(rendered.unchecked, /checked=""/);
  assert.match(rendered.checked, /checked=""/);
  assert.match(read('../components/TermsConsent.jsx'), /checked=\{checked\}[\s\S]*onChange=\{\([^)]*\) => onChange\([^)]*\.target\.checked\)\}/);
  assert.match(read('../Login.jsx'), /<fieldset disabled=\{!termsAgreed\}/);
  assert.match(read('./AuthContext.jsx'), /\[termsAgreed, setTermsAgreed\] = useState\(false\)/);
});

test('Terms renders a styled h1, update date and semantic section headings', () => {
  assert.match(rendered.terms, /<h1>Terms of Use<\/h1>/);
  assert.match(rendered.terms, /Last updated: <time dateTime="2026-09-16">16 September 2026<\/time>/i);
  assert.equal((rendered.terms.match(/<h1>/g) || []).length, 1);
  assert.equal((rendered.terms.match(/<section><h2>/g) || []).length, 8);
  assert.match(rendered.terms, /\.public-terms h1 \{[^}]*font-size:clamp/);
  assert.match(rendered.terms, /width:min\(100%,680px\)/);
  assert.match(rendered.terms, /line-height:1.75/);
});

test('Terms retains zero tolerance, prohibited behavior and suspension/removal language', () => {
  for (const wording of ['zero tolerance for objectionable content and abusive users', 'harassment', 'bullying', 'threats', 'hate speech', 'sexually explicit content', 'sexual abuse content', 'spam or malicious behaviour', 'violating users may be suspended or removed from imBored']) assert.ok(rendered.terms.includes(wording));
});

test('Terms retains reporting and blocking instructions', () => {
  for (const wording of ['Reporting content or users', 'Report &amp; Block', 'Choose a reason', 'moderation queue', 'immediately blocks the player and hides their chat', 'Blocking users', 'Block without a report', 'Safety &amp; account']) assert.ok(rendered.terms.includes(wording));
});

test('Terms retains the 24-hour moderation target and content-removal commitment', () => {
  assert.ok(rendered.terms.includes('We review valid safety reports as quickly as possible, targeting within 24 hours.'));
  assert.ok(rendered.terms.includes('We act on violations by removing offending content and suspending or removing offending users.'));
});

test('Terms renders support email and public navigation with focus and touch styling', () => {
  assert.match(rendered.terms, /href="mailto:support@imbored.au">support@imbored.au<\/a>/);
  assert.match(rendered.terms, /href="\/privacy">Privacy Policy<\/a>/);
  assert.match(rendered.terms, /href="\/support">Support<\/a>/);
  assert.match(rendered.terms, /href="\/">Home<\/a>/);
  assert.match(rendered.terms, /nav class="public-terms__nav" aria-label="Public pages"/);
  assert.match(rendered.terms, /\.public-terms a:focus-visible/);
  assert.match(rendered.terms, /\.public-terms a \{[^}]*min-height:44px/);
});

test('native link mechanism stays in Capacitor Browser; normal web links retain their URLs', () => {
  const consent = read('../components/TermsConsent.jsx');
  assert.match(consent, /if \(!isNativePlatform\(\)\) return/);
  assert.match(consent, /event.preventDefault\(\)/);
  assert.match(consent, /await Browser.open\(\{ url \}\)/);
  assert.match(rendered.unchecked, /target="_blank" rel="noopener noreferrer"/);
});

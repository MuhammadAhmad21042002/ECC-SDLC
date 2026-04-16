# Mermaid CLI Smoke Test Results

**Sprint 2 Day 1 — confirm all 3 before noon**

## Verification Test 1 — Warisha's Machine

- **Date/Time:** ******\_\_\_******
- **OS:** ******\_\_\_******
- **mmdc version:** ******\_\_\_******
- **Command run:** `mmdc -i test-fixtures/test-mermaid.md -o test-fixtures/test-output.svg`
- **SVG produced:** ☐ Yes ☐ No
- **Diagram renders in browser:** ☐ Yes ☐ No
- **Notes / issues:** ******\_\_\_******
- **Sign-off:** ☐ Warisha confirmed

---

## Verification Test 2 — Zainab's Machine

- **Date/Time:** ******\_\_\_******
- **OS:** ******\_\_\_******
- **mmdc version:** ******\_\_\_******
- **Command run:** `mmdc -i test-fixtures/test-mermaid.md -o test-fixtures/test-output.svg`
- **SVG produced:** ☐ Yes ☐ No
- **Diagram renders in browser:** ☐ Yes ☐ No
- **Notes / issues:** ******\_\_\_******
- **Sign-off:** ☐ Zainab confirmed

---

## Verification Test 3 — Ahmad's Machine

- **Date/Time:** ******\_\_\_******
- **OS:** ******\_\_\_******
- **mmdc version:** ******\_\_\_******
- **Command run:** `mmdc -i test-fixtures/test-mermaid.md -o test-fixtures/test-output.svg`
- **SVG produced:** ☐ Yes ☐ No
- **Diagram renders in browser:** ☐ Yes ☐ No
- **Notes / issues:** ******\_\_\_******
- **Sign-off:** ☐ Ahmad confirmed

---

## Machine-Specific Setup Notes

### Windows (if npm global install fails)

```bash
npx @mermaid-js/mermaid-cli -i test-fixtures/test-mermaid.md -o test-fixtures/test-output.svg
```

### macOS / Linux

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i test-fixtures/test-mermaid.md -o test-fixtures/test-output.svg
```

### Chrome not found error

If mmdc reports "Could not find Chrome":

```bash
npx puppeteer browsers install chrome-headless-shell
```

Then retry the mmdc command.

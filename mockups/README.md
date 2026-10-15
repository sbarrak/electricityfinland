# UI mockups

Three clickable, responsive directions for a calmer dashboard. They keep every feature of the current app. Open `index.html` in a browser (double-click works) for the overview, the feature map and the recommendation.

| File | What it is |
|---|---|
| `index.html` | Overview: the problem, the three directions, the new structure, where every feature goes, the recommendation |
| `a-calm.html` | **A · Calm**: a large current price, one plain sentence, the day's bars, a planner |
| `b-studio.html` | **B · Studio** (recommended): sidebar workspace, KPI strip, chart + inspector |
| `c-signal.html` | **C · Signal**: dark first, a 24-hour price dial, the cheapest 1 / 3 / 6 h windows |
| `kit.js` | Shared example data, the price maths of `web/costs.js`, SVG charts for every view, and the shared Explore / Usage / Alerts / Settings panels |
| `kit.css` | Shared tokens and components; each concept page changes the tokens and its own layout |
| `shots/` | Screenshots used by the overview, including the current UI |

Every concept has the same five sections (`#now`, `#explore`, `#usage`, `#alerts`, `#settings`) and works on a phone (tab bar), a tablet and a desktop. The data is made up and "now" is fixed at Thu 15 Oct 2026 15:10, so nothing here touches the real app or its backend.

import { getUsernameFromGitHubPage, createDashboardCard, renderDashboard } from "./ui.js";

function isProfileOrRepoPage() {
  // Good enough for MVP: any github.com/<something>
  return location.hostname === "github.com";
}

function mountCard(card) {
  // Try to insert near the right-side column on profile pages.
  // Fallback: stick it at top of main content.
  const sidebar = document.querySelector(".Layout-sidebar");
  const main = document.querySelector("main");

  if (sidebar) {
    sidebar.prepend(card);
  } else if (main) {
    main.prepend(card);
  } else {
    document.body.prepend(card);
  }
}

async function fetchAnalytics(username) {
  return await chrome.runtime.sendMessage({ type: "FETCH_ANALYTICS", username });
}

(async function init() {
  if (!isProfileOrRepoPage()) return;

  const username = getUsernameFromGitHubPage();
  if (!username) return;

  // Avoid duplicates
  if (document.getElementById("ghpd-card")) return;

  const card = createDashboardCard();
  mountCard(card);

  const res = await fetchAnalytics(username);
  if (!res.ok) {
    card.querySelector("#ghpd-badge").textContent = "Error";
    card.querySelector("#ghpd-foot").textContent = res.error || "Failed to load analytics.";
    return;
  }

  renderDashboard(card, res.payload, res.source);
})();

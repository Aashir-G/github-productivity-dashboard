async function load() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  document.getElementById("token").value = gh_token || "";
}
load();

document.getElementById("save").addEventListener("click", async () => {
  const token = document.getElementById("token").value.trim();
  const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });

  const status = document.getElementById("status");
  status.textContent = res.ok ? "Saved token." : `Error: ${res.error}`;
});

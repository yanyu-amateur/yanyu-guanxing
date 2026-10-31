var SIMULATOR_VERSION = "2.1.7";

(function () {
    function applyVersion() {
        var el = document.getElementById("appVersion");
        if (el) el.textContent = "v" + SIMULATOR_VERSION;
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applyVersion);
    } else {
        applyVersion();
    }
})();

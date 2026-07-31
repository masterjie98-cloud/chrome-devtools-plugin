(function installDebugFixture() {
  function computeTotal(items, taxRate) {
    const subtotal = items.reduce((sum, item) => sum + item, 0);
    const tax = subtotal * taxRate;
    const total = subtotal + tax;
    document.querySelector("#result").textContent = String(total);
    return { subtotal, tax, total };
  }

  window.debugFixture = {
    computeTotal,
    runLater() {
      setTimeout(() => computeTotal([3, 7], 0.1), 0);
      return "scheduled";
    },
  };

  document
    .querySelector("#run")
    .addEventListener("click", () => computeTotal([5, 15], 0.2));
})();

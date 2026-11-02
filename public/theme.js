// Sets the theme picked in the sidebar (src/ui/theme.ts) before the first paint, so a forced theme never flashes the other.
try {
  var theme = localStorage.getItem('plonk.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}

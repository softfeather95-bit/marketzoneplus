/* MarketZone authenticated server transport. Protected records are never authoritative in browser storage. */
(function () {
  'use strict';
  function request(path, options) {
    options = options || {};
    return fetch('/api/market' + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return { error: 'The server returned an invalid response.' }; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.error || 'The operation could not be completed.');
          error.status = response.status;
          error.data = data;
          throw error;
        }
        return data;
      });
    });
  }
  window.MZServer = {
    request: request,
    ready: request('/auth/config').catch(function () {
      return { setupRequired: false, payments: { wallet: true, cod: true, card: false, online: false, manualAssistance: true }, availableCountries: ['United States'], countries: window.MZ_COUNTRIES || [] };
    })
  };
})();

/* =========================================================
   DTR Manager API Client
   - Small wrapper around fetch()
   - Keeps frontend code readable while moving data to Express/SQLite
   - Used by assets/js/app.js in the next revision
   ========================================================= */
(function () {
  'use strict';

  function request(path, options) {
    var fetchOptions = options || {};
    var headers = fetchOptions.headers || {};

    if (fetchOptions.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(path, {
      method: fetchOptions.method || 'GET',
      headers: headers,
      body: fetchOptions.body,
      credentials: 'same-origin'
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;

        if (text) {
          try {
            data = JSON.parse(text);
          } catch (err) {
            data = { raw: text };
          }
        }

        if (!res.ok) {
          var message = data && data.error ? data.error : 'Request failed.';
          var error = new Error(message);
          error.status = res.status;
          error.data = data;
          throw error;
        }

        return data;
      });
    });
  }

  function json(method, path, body) {
    return request(path, {
      method: method,
      body: JSON.stringify(body || {})
    });
  }

  window.dtrApi = {
    getBootstrap: function () {
      return request('/api/bootstrap');
    },

    getStats: function () {
      return request('/api/stats');
    },

    getEmployees: function () {
      return request('/api/employees');
    },

    saveEmployee: function (employee) {
      return json('PUT', '/api/employees/' + encodeURIComponent(employee.id), employee);
    },

    setEmployeeStatus: function (id, disabled) {
      return json('PATCH', '/api/employees/' + encodeURIComponent(id) + '/status', {
        disabled: !!disabled
      });
    },

    recordPunch: function (employeeId, action) {
      return json('POST', '/api/punches', {
        employeeId: employeeId,
        action: action
      });
    },

    getTodayPunches: function () {
      return request('/api/punches/today');
    },

    getMonthlyPunches: function (month, employeeId) {
      var query = '?month=' + encodeURIComponent(month || '');

      if (employeeId) {
        query += '&employeeId=' + encodeURIComponent(employeeId);
      }

      return request('/api/punches/monthly' + query);
    },

    getMonthlyDtr: function (month) {
      return request('/api/dtr/monthly?month=' + encodeURIComponent(month || ''));
    },

    getSetting: function (key) {
      return request('/api/settings/' + encodeURIComponent(key));
    },

    setSetting: function (key, value) {
      return json('PUT', '/api/settings/' + encodeURIComponent(key), {
        value: value
      });
    },

    getAdminAccount: function () {
      return request('/api/admin-account');
    },

    saveAdminAccount: function (account) {
      return json('PUT', '/api/admin-account', account);
    }
  };
})();
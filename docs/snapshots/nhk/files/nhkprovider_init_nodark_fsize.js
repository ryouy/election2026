(async () => {
  await window.nhkLib.initialize({
    auth: {
      config: {
        accountlessAuthZ: {
          authServerUrl: "https://r.authz.ac1.nhk",
        },
        accountlessAuthZAbroad: {
          authServerUrl: "https://a.authz.ac1.nhk",
        },
        accountlessAuthZEmergency: {
          authServerUrl: "https://d.authz.ac1.nhk",
        },
        accountAuthN: {
          authServerUrl: "https://oa.authn.ac2.nhk/api/v1",
        },
        accountAuthZ: {
          authServerUrl: "https://r.authz.ac2.nhk",
        },
        setCookieServerUrl: "https://bake.web.nhk",
        statusManagement: {
          serverUrl: "https://stmgt.web.nhk",
        },
      },
    },
    siteConfig: {
      appName: "nhk-nwa-web",
      siteGroup: "dms",
    },
    profile: {
      accountlessProfileServerUrl: "https://profile.ac1.nhk/v1.0",
      accountProfileServerUrl: "https://profile.ac2.nhk/v1.0",
    },
    enableFontSizeScaleFactor: true,
    disableDarkMode: true,
  });
})();

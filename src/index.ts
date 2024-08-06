const builderSubdomains = ["dashboard", "builder", "builder-next"];

const replaceKnackReferences = (url: URL, respText: string) => {
  if (
    builderSubdomains.some((sub) => url.hostname.startsWith(sub)) ||
    url.hostname.startsWith("assets.public")
  ) {
    return respText
      .replace(/assets\.public\.knack/g, "assets--public.knack")
      .replace(/(?!@)knack\.com/g, "knack.work");
  }
  return respText;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originalPath = url.pathname;
    const originalHostname = url.hostname;
    url.hostname = url.hostname
      .replace("knack.work", "knack.com")
      .replace(/--/g, ".");
    const origin = request.headers.get("origin")?.replace(/https?:\/\//, "");

    // prevent CORS requests to builder from non-builder origins
    if (
      url.pathname.startsWith("/v1") &&
      origin &&
      !builderSubdomains.some((sub) => origin.startsWith(sub))
    ) {
      return new Response("Not Found", { status: 404 });
    }

    let account: string, app: string;
    if (originalPath.startsWith("/live-app")) {
      [, account, app] = originalPath.split("/").slice(1);
    } else {
      account = originalHostname.split(".")[0];
      app = originalPath.split("/")[1];
    }
    // replaces references to knack.com with knack.work for builder assets

    const liveAppPath = `/live-app/${account}/${app}`;
    url.pathname = originalPath.replace(/^\/live-app\/.+?\/.+?\//, "/");

    const resp = await fetch(url.toString(), request);

    let respText = await resp.text();
    if (originalPath.endsWith(`/${app}`)) {
      // make live app talk to proxy instead of knack.com
      respText = respText.replace(
        /api_domain='knack\.com'/,
        `api_domain='knack.work${liveAppPath}';`,
      );
    }
    if (url.pathname.startsWith("/v1/applications")) {
      // prevent live app from thinking we're embedded
      const script = `Knack.isOnNonKnackDomain = () => false;`;
      respText = script + respText;
    }
    respText = replaceKnackReferences(url, respText);

    const newHeaders = new Headers(resp.headers);
    const setCookie = newHeaders.get("set-cookie");
    if (setCookie) {
      let newCookie = setCookie.replace(
        /Domain=knack\.com/gi,
        "Domain=knack.work",
      );

      if (url.pathname.startsWith(liveAppPath)) {
        // scope live app cookies to live app path
        newHeaders.set(
          "set-cookie",
          newCookie.replace(/Path=.+?(;)?/gi, `Path=${liveAppPath}$1`),
        );
      } else {
        newHeaders.set("set-cookie", newCookie);
      }
    }

    return new Response(respText, { ...resp, headers: newHeaders });
  },
} satisfies ExportedHandler;

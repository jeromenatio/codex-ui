import { JSDOM } from "jsdom";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./src/App.tsx";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://127.0.0.1:4180"
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true
});

const bootstrapPayload = await fetch("http://127.0.0.1:4180/api/bootstrap").then((response) => response.json());

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;

  if (url.includes("/api/bootstrap")) {
    return {
      ok: true,
      async json() {
        return bootstrapPayload;
      }
    };
  }

  if (url.includes("/api/sessions")) {
    return {
      ok: true,
      async json() {
        return { sessions: bootstrapPayload.sessions ?? [] };
      }
    };
  }

  return {
    ok: true,
    async json() {
      return {};
    }
  };
};

class FakeEventSource {
  constructor() {}
  addEventListener() {}
  close() {}
}

globalThis.EventSource = FakeEventSource;

const root = ReactDOM.createRoot(document.getElementById("root"));

try {
  root.render(React.createElement(App));
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log(document.body.innerHTML);
} catch (error) {
  console.error(error);
  process.exit(1);
}

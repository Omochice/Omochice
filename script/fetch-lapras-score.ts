// This is from https://github.com/yuki-yano/yuki-yano/blob/49fd52ec52071ef80b1db386049a4c509f207570/scripts/fetch_lapras_score.ts
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { existsSync } from "jsr:@std/fs@0.229.1";

const response = await fetch("https://lapras.com/public/K4AJVET");
const html = await response.text();
const doc = new DOMParser().parseFromString(html, "text/html");

const thumbnailUrl = doc?.querySelector("meta[name='twitter:image']")
  ?.getAttribute("content");

if (thumbnailUrl == null) {
  Deno.exit(1);
}

const imageResponse = await fetch(thumbnailUrl);
const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());

if (!existsSync("./lapras")) {
  Deno.mkdirSync("./lapras");
}
Deno.writeFileSync("./lapras/score.png", imageBytes);

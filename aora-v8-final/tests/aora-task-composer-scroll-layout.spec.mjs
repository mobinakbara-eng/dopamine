import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const composerCss=await readFile(new URL("../app/manager-task-composer-v2.css",import.meta.url),"utf8");

test("tall mobile task composer keeps its controls reachable through an internal scroller",async({page})=>{
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <style>
      *{box-sizing:border-box}html,body{height:100%;margin:0;font:16px Arial;background:#ddd}
      .u-dialog-backdrop{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.48);z-index:1000}
      .u-dialog{width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff}
      .aora-composer-section{min-height:245px}
      ${composerCss}
    </style>
    <div class="u-dialog-backdrop aora-composer-backdrop">
      <form class="u-dialog aora-composer-dialog" data-composer="manual-v3">
        <header class="aora-composer-head"><div><h2>Aufgabe erstellen</h2><p>Aufgabe, Foto, Mitarbeiter, Deadline und Pflichtstatus.</p></div><button type="button">×</button></header>
        <div class="aora-composer-body">
          <section class="aora-composer-section"><strong>1 Aufgabe</strong></section>
          <section class="aora-composer-section"><strong>2 Mitarbeiter</strong></section>
          <section class="aora-composer-section"><strong>3 Zeit</strong></section>
          <section class="aora-composer-section"><strong>4 Pflichtaufgabe</strong></section>
          <div class="aora-composer-summary">Zusammenfassung</div>
        </div>
        <footer class="aora-composer-footer"><span>EK Tacheles</span><div><button type="button">Abbrechen</button><button type="submit">Aufgabe erstellen</button></div></footer>
      </form>
    </div>`);

  const dialog=page.locator(".aora-composer-dialog");
  const body=dialog.locator(".aora-composer-body");
  await expect(dialog.locator(".aora-composer-head")).toBeInViewport();
  await expect(dialog.locator(".aora-composer-footer")).toBeInViewport();

  const initial=await body.evaluate(element=>({
    top:element.scrollTop,
    scrollHeight:element.scrollHeight,
    clientHeight:element.clientHeight,
    overflowY:getComputedStyle(element).overflowY,
    touchAction:getComputedStyle(element).touchAction,
    dialogRect:element.closest(".aora-composer-dialog").getBoundingClientRect().toJSON(),
    viewportHeight:window.innerHeight
  }));
  expect(initial.top).toBe(0);
  expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
  expect(initial.overflowY).toBe("auto");
  expect(initial.touchAction).toBe("pan-y");
  expect(initial.dialogRect.top).toBeGreaterThanOrEqual(0);
  expect(initial.dialogRect.bottom).toBeLessThanOrEqual(initial.viewportHeight+1);
  await expect(body.getByText("1 Aufgabe")).toBeInViewport();

  await body.evaluate(element=>element.scrollTo(0,element.scrollHeight));
  await expect.poll(()=>body.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
  await expect(body.getByText("4 Pflichtaufgabe")).toBeInViewport();
  await expect(dialog.getByRole("button",{name:"Aufgabe erstellen"})).toBeInViewport();
});

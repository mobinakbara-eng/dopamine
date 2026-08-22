import { defineConfig, devices } from "@playwright/test";

const baseURL=process.env.AORA_PREVIEW_URL||"http://127.0.0.1:4173";
const desktop={...devices["Desktop Chrome"]};
const mobile={...devices["Desktop Chrome"],viewport:{width:390,height:844},isMobile:true,hasTouch:true};
export default defineConfig({
  testDir:"./tests",
  timeout:180000,
  expect:{timeout:15000},
  fullyParallel:false,
  workers:1,
  retries:0,
  reporter:[["line"],["json",{outputFile:"playwright-report.json"}]],
  use:{
    baseURL,
    headless:true,
    screenshot:"only-on-failure",
    trace:"off",
    video:"off",
    ignoreHTTPSErrors:false
  },
  webServer:process.env.AORA_PREVIEW_URL?undefined:{
    command:"python3 -m http.server 4173 --bind 127.0.0.1 -d dist",
    url:"http://127.0.0.1:4173",
    reuseExistingServer:!process.env.CI,
    timeout:30000
  },
  projects:[
    {
      name:"composer-scroll-layout",
      testMatch:/aora-task-composer-scroll-layout\.spec\.mjs/,
      use:mobile
    },
    {
      name:"privacy-public",
      testMatch:/aora-privacy\.spec\.mjs/,
      use:desktop
    },
    {
      name:"unified-release",
      dependencies:["composer-scroll-layout"],
      testMatch:/aora-unified-release\.spec\.mjs/,
      use:desktop
    },
    {
      name:"mobile-layout",
      dependencies:["unified-release"],
      testMatch:/aora-mobile-layout\.spec\.mjs/,
      use:mobile
    },
    {
      name:"chromium",
      dependencies:["mobile-layout"],
      testMatch:/aora-(accessibility|four-role|unified-login|time-correction-clock-hub|navigation-qa|manager-task-composer|task-runtime|inventory-receipt-print)\.spec\.mjs/,
      use:desktop
    },
    {
      name:"timesheet-approval",
      dependencies:["chromium"],
      testMatch:/aora-timesheet-(approval|release|document-signing)\.spec\.mjs/,
      use:desktop
    }
  ]
});

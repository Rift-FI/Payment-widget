/**
 * E2E: paying a payment link from a phone.
 *
 * The widget is driven through a real browser against a production build,
 * with the Rift API mocked at the network boundary. What these assert is the
 * payer's experience: they can see what they will be charged before
 * committing, the prompt is only raised once the form is actually valid, the
 * screen resolves itself without a refresh, and a failure explains itself
 * without accusing them of something they did not do.
 */
import { test, expect, type Page } from "@playwright/test";

const INVOICE_ID = "11111111-2222-4333-8444-555555555555";
const ADDRESS = "0x8daA560362b330b71E893fD1AD1B24A640d8022A";

/** The widget reads its invoice from a base64 query param. */
function linkFor(amount = 10, extra: Record<string, unknown> = {}) {
  const payload = { chain: "BASE", token: "USDC", amount, address: ADDRESS, invoiceId: INVOICE_ID, ...extra };
  return `/?invoice=${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

interface ApiOpts {
  quoteStatus?: number;
  quoteBody?: unknown;
  createStatus?: number;
  createBody?: unknown;
  /** Status sequence returned by polling, last value repeats. */
  statuses?: Array<Record<string, unknown>>;
}

async function mockApi(page: Page, opts: ApiOpts = {}) {
  const calls: { method: string; url: string; body?: any }[] = [];

  // Everything not explicitly mocked gets an empty 200 so a flaky external
  // host (fonts, RPC, analytics) cannot slow or break a run.
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      const type = route.request().resourceType();
      const contentType = type === "stylesheet" ? "text/css" : type === "script" ? "text/javascript" : "application/json";
      return route.fulfill({ status: 200, contentType, body: contentType.includes("json") ? "{}" : "" });
    }
  );

  await page.route("**/v1/rates**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) })
  );

  await page.route("**/onramp/quote**", (r) => {
    calls.push({ method: "GET", url: r.request().url() });
    return r.fulfill({
      status: opts.quoteStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        opts.quoteBody ?? {
          currency: "KES",
          fiatAmount: 1350,
          cryptoAmount: 10.02,
          rate: 133,
          fee: 13,
          invoice: { id: INVOICE_ID, amount: 10, token: "USDC", chain: "BASE" },
        }
      ),
    });
  });

  let polls = 0;
  await page.route(`**/v1/invoices/${INVOICE_ID}/onramp`, (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    calls.push({ method: "POST", url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({
      status: opts.createStatus ?? 201,
      contentType: "application/json",
      body: JSON.stringify(
        opts.createBody ?? { orderId: "ord_1", status: "processing", currency: "KES", fiatAmount: 1350, cryptoAmount: 10.02 }
      ),
    });
  });

  await page.route(`**/v1/invoices/${INVOICE_ID}/onramp/ord_1`, (r) => {
    const seq = opts.statuses ?? [{ orderId: "ord_1", status: "completed", transactionHash: "0xabc" }];
    const body = seq[Math.min(polls++, seq.length - 1)];
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  return calls;
}

/** Open the link and get to the mobile money form. */
async function openMobileMoney(page: Page, url = linkFor()) {
  await page.goto(url);
  await page.getByRole("button", { name: /Mobile money/i }).click();
}

test("the option is offered, and shows what you will pay before you commit", async ({ page }) => {
  const errors = watchErrors(page);
  const calls = await mockApi(page);
  await openMobileMoney(page);

  // Priced on arrival, in local currency, for the invoice's crypto amount.
  await expect(page.getByText("KES 1,350")).toBeVisible();
  await expect(page.getByText(/for 10 USDC/i)).toBeVisible();
  // Quoting must never raise a prompt.
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("Nigeria is never offered — there is no prompt to push there", async ({ page }) => {
  await mockApi(page);
  await openMobileMoney(page);
  const options = await page.locator("select").first().locator("option").allInnerTexts();
  expect(options.join(" ")).not.toMatch(/nigeria|NGN/i);
  expect(options.join(" ")).toMatch(/Kenya/);
});

test("the prompt cannot be sent until the number is plausible", async ({ page }) => {
  await mockApi(page);
  await openMobileMoney(page);
  const send = page.getByRole("button", { name: /Send payment request/i });
  await expect(send).toBeDisabled();
  await page.getByPlaceholder(/0712/).fill("12");
  await expect(send).toBeDisabled();
  await page.getByPlaceholder(/0712/).fill("0712345678");
  await expect(send).toBeEnabled();
});

test("sending prompts the payer, then settles without a refresh", async ({ page }) => {
  const errors = watchErrors(page);
  const calls = await mockApi(page, {
    statuses: [
      { orderId: "ord_1", status: "processing" },
      { orderId: "ord_1", status: "completed", transactionHash: "0xabc" },
    ],
  });
  await openMobileMoney(page);
  await page.getByPlaceholder(/0712/).fill("0712345678");
  await page.getByRole("button", { name: /Send payment request/i }).click();

  await expect(page.getByText(/Check your phone/i)).toBeVisible();
  // Resolves on its own.
  await expect(page.getByText(/Payment complete|Payment successful|Thank you/i).first()).toBeVisible({ timeout: 20_000 });

  const post = calls.find((c) => c.method === "POST");
  expect(post?.body).toMatchObject({ phone: "0712345678", network: "Safaricom", currency: "KES" });
  // The amount is never sent by the client — the server charges the invoice.
  expect(post?.body?.amount).toBeUndefined();
  expect(errors).toEqual([]);
});

test("a failure explains itself without blaming the payer", async ({ page }) => {
  await mockApi(page, {
    statuses: [
      { orderId: "ord_1", status: "failed", reason: "insufficient_funds", message: "There wasn't enough money in the account to complete this payment." },
    ],
  });
  await openMobileMoney(page);
  await page.getByPlaceholder(/0712/).fill("0712345678");
  await page.getByRole("button", { name: /Send payment request/i }).click();

  await expect(page.getByText(/Payment not completed/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/wasn't enough money/i)).toBeVisible();
  await expect(page.getByText(/you cancelled/i)).toHaveCount(0);
  // And they can have another go.
  await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
});

test("a rate-limited number is told plainly, and not invited to retry", async ({ page }) => {
  await mockApi(page, {
    createStatus: 429,
    createBody: {
      error: "TOO_MANY_CANCELLATIONS",
      message: "Too many payment requests were cancelled from this number. Try again in 24 hours.",
      details: { retryAfterHours: 24 },
    },
  });
  await openMobileMoney(page);
  await page.getByPlaceholder(/0712/).fill("0712345678");
  await page.getByRole("button", { name: /Send payment request/i }).click();

  await expect(page.getByText(/Try again in 24 hours/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Try again$/i })).toHaveCount(0);
});

test("no rate-limit notice is shown up front — the payer is not an account holder", async ({ page }) => {
  await mockApi(page);
  await openMobileMoney(page);
  await expect(page.getByText(/3 times/i)).toHaveCount(0);
  await expect(page.getByText(/paused for 24 hours/i)).toHaveCount(0);
});

test("an unquotable market surfaces the reason and blocks sending", async ({ page }) => {
  await mockApi(page, {
    quoteStatus: 503,
    quoteBody: { error: "ONRAMP_UNAVAILABLE", message: "KES mobile money is unavailable right now" },
  });
  await openMobileMoney(page);
  await expect(page.getByText(/unavailable right now/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send payment request/i })).toBeDisabled();
});

test("an open-amount link does not offer mobile money", async ({ page }) => {
  await mockApi(page);
  await page.goto(linkFor(0));
  // Open amount asks for a figure first; the phone option needs a fixed
  // invoice amount because the server raises the prompt from the invoice.
  await expect(page.getByRole("button", { name: /Mobile money/i })).toHaveCount(0);
});

test("a link with no invoice id does not offer mobile money", async ({ page }) => {
  await mockApi(page);
  const payload = { chain: "BASE", token: "USDC", amount: 10, address: ADDRESS };
  await page.goto(`/?invoice=${Buffer.from(JSON.stringify(payload)).toString("base64")}`);
  await expect(page.getByRole("button", { name: /Crypto wallet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mobile money/i })).toHaveCount(0);
});

# Secure Razorpay checkout backend

This Cloudflare Worker creates Razorpay orders and verifies completed payments on the server. It keeps the Razorpay secret out of the public GitHub Pages site.

## Before going live

1. In Razorpay, activate UPI/domestic checkout and apply for international payments if you want overseas cards charged in USD. Razorpay must approve the relevant capabilities on the merchant account.
2. Create a Cloudflare Worker from this folder and set `ALLOWED_ORIGIN` to the exact public origin of the service page (currently `https://manojjakka.github.io`).
3. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as Worker secrets. Never add the secret to HTML, Git, or a public message.
4. Deploy the Worker and copy its URL. Configure that URL in the service page's `PAYMENT_API` constant before publishing the page.
5. Configure Razorpay to capture payments automatically, since the unlock check requires a captured payment.

## Checkout behavior

- USD checkout uses the published USD price and requires Razorpay international payments to be enabled.
- INR checkout converts the same USD price using Frankfurter's latest USD/INR reference rate and rounds to the nearest paise. The exchange rate and date are attached to the Razorpay order notes. The rate is a reference rate; Razorpay/banks may apply their own charges or conversion rules.
- The backend verifies the checkout HMAC and independently checks the payment and order with Razorpay before returning an unlock confirmation.
- The page can then reveal the matching intake form. This is an intake unlock, not automatic website publishing or a promise of a delivery time.

The Worker intentionally does not include Razorpay test/live credentials. Start with test keys; switch to live keys only after the merchant account and checkout have been approved and the test flow has been reviewed.

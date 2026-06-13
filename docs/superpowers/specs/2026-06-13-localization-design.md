# SnapDuka Localization and Côte d'Ivoire Design

## Scope

Add French localization and Côte d'Ivoire support with XOF, country-specific
phones, addresses, fulfillment rules, and configurable payment channels.

## Architecture

The application uses locale dictionaries selected by URL cookie and seller
country default. English remains available everywhere; French is the default
for Côte d'Ivoire. Stored operational states remain locale-neutral identifiers.
Formatting uses `Intl` for currency, dates, and numbers.

Country configuration expands to include locale, currency precision, phone
metadata, address labels, payment channels, and fulfillment capabilities.
Country behavior is read from configuration rather than conditionals spread
through UI code.

## Data and Routes

`country_configs` gains locale and payment metadata. `CI` and `XOF` are added
to database enums and seeded configuration. Public and seller routes accept a
locale prefix while existing unprefixed links continue to resolve through
default-locale negotiation.

## Behavior

Seller onboarding, dashboard navigation, storefront, checkout, receipts,
tracking, support, validation messages, and transactional templates support
English and French. Seller-entered catalog content is not machine translated.

XOF displays with zero fractional digits. Côte d'Ivoire phones normalize to
E.164 `+225` format. Addresses use district/commune/city labels from country
configuration. Paystack channels are presented only when enabled by current
provider and country configuration.

## Failure Handling

Unknown locales redirect to the country default. Missing translation keys fall
back to English and are caught by a dictionary parity test. Unsupported payment
channels are rejected server-side even if submitted by a stale client.

## Acceptance

Tests cover dictionary parity, locale negotiation, French seller and buyer
journeys, XOF formatting, Côte d'Ivoire phone normalization, address labels,
country isolation, and server rejection of unavailable payment channels.

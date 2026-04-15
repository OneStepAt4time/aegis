Add a regression guard that verifies the server returns a correct Content-Length header for the dashboard index.html.

This test simulates the presence of an `index.html` and asserts that the `Content-Length` response header equals the actual byte length of the payload (Buffer.byteLength). This helps detect platform-specific mismatches (Windows CRLF/BOM or encoding issues) early in CI.

Notes:
- This PR contains only a test to guard the regression for #1766. It does not change runtime code.
- If CI on Windows exposes a failing case, I will follow up with a minimal fix (likely coerce any manual Content-Length calculation to use Buffer.byteLength or avoid setting Content-Length when response is transformed).

Related: Issue #1766

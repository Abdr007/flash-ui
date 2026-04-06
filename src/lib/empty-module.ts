// Empty module used as browser fallback for Node.js built-ins
// that flash-sdk / @coral-xyz/anchor try to import but don't need in browser.
export default {};
export const readFileSync = () => { throw new Error("fs not available in browser"); };
export const existsSync = () => false;

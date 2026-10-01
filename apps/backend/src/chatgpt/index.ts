/**
 * Sign in with ChatGPT: the LLM provider that bills the developer's ChatGPT subscription. Imports
 * no workspace packages, so `pnpm chatgpt:login` runs from source without a build.
 */
export { ChatGptAuth, ChatGptAuthError } from './auth.ts';
export { chatGptClientLayer } from './client.ts';
export {
  ChatGptCredentials,
  CredentialsReadError,
  CredentialsWriteError,
  credentialsPath,
  readCredentials,
  writeCredentials,
} from './credentials.ts';

declare module 'ua-parser-js' {
  export class UAParser {
    constructor(uaString?: string);
    getBrowser(): { name?: string; version?: string };
    getOS(): { name?: string; version?: string };
    getDevice(): { type?: string; vendor?: string; model?: string };
  }
}

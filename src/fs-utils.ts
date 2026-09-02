/** Remove the optional UTF-8 byte-order mark decoded at the start of a file. */
export function stripLeadingBom(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

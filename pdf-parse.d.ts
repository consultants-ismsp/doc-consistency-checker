// pdf-parse 타입 선언(공식 @types 없음). 오프라인 추출 스크립트(scripts/*)에서만 사용.
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}

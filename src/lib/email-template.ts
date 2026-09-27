// Shared HTML wrapper for transactional emails (Appwrite Messaging). Plain template
// helper — not a server action — so it can be imported from any 'use server' module
// without hitting the "use server files can only export async functions" constraint.
// Anthracite #2C2C2E + Orange #E8A33D — matches the current public-site brand (AGENTS.md).
export function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F5; padding:48px 16px;">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%; background-color:#FFFFFF; border-radius:20px; overflow:hidden; box-shadow:0 20px 50px -20px rgba(44,44,46,0.25);">
      <tr>
        <td style="height:4px; background-color:#E8A33D; font-size:0; line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="background-color:#2C2C2E; padding:36px 40px; text-align:center;">
          <span style="font-family:Georgia, 'Times New Roman', serif; font-weight:300; font-size:23px; color:#FFFFFF; letter-spacing:0.5px;">My Best Consultant</span>
        </td>
      </tr>
      <tr>
        <td style="padding:44px 40px 40px;">
          <h1 style="margin:0 0 18px; font-family:Georgia, 'Times New Roman', serif; font-weight:700; font-size:21px; color:#2C2C2E;">${title}</h1>
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px; background-color:#FAFAFA; border-top:1px solid #EEEEEF; text-align:center;">
          <p style="margin:0; font-size:11px; color:#9B9B9E;">My Best Consultant · La plateforme AI des consultants</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`
}

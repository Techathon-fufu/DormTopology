import { cn } from '@/lib/utils'

/** Decorative diagram only; not a reconstruction or saved project thumbnail. */
export function DeskIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 330" fill="none" className={cn('h-auto w-full', className)} aria-hidden="true">
      <ellipse cx="270" cy="286" rx="190" ry="20" fill="#D9E5DD" opacity=".5" />
      <path d="M88 90L327 43L438 94L197 144L88 90Z" fill="#E2E8DF" />
      <path d="M88 90V202L197 258V144L88 90Z" fill="#E8EDE5" />
      <path d="M197 144L438 94V210L197 258V144Z" fill="#F2F4EE" />
      <path d="M108 185L349 136L449 184L208 235L108 185Z" fill="#D7BD94" />
      <path d="M108 185V195L208 246L449 195V184L208 235L108 185Z" fill="#B99D74" />
      <path d="M126 202V274L137 279V207M419 205V273L430 270V202M208 246V298L219 296V244" stroke="#526258" strokeWidth="9" strokeLinejoin="round" />
      <path d="M126 119L353 72L410 98L183 146L126 119Z" fill="#D7BD94" />
      <path d="M126 119V126L183 153L410 105V98L183 146L126 119Z" fill="#B99D74" />
      <path d="M143 104V79L171 73V98L143 104Z" fill="#9DAD91" /><path d="M174 97V68L188 65V94L174 97Z" fill="#D9A979" />
      <path d="M197 91V71L226 65V85L197 91Z" fill="#799C91" />
      <path d="M265 103L344 87V145L265 161V103Z" fill="#334D47" stroke="#263F39" strokeWidth="5" strokeLinejoin="round" />
      <path d="M272 108L337 95V140L272 153V108Z" fill="#90BAB0" />
      <path d="M299 154V173L283 177L307 186L324 182L304 174" stroke="#334D47" strokeWidth="4" strokeLinejoin="round" />
      <path d="M235 193L294 181L319 192L259 205L235 193Z" fill="#7D9086" />
      <path d="M327 181C333 175 344 178 344 183C344 188 330 190 327 185V181Z" fill="#526C61" />
      <path d="M174 161L187 158V178C186 185 176 187 174 181V161Z" fill="#E2C895" />
      <path d="M166 149L182 128L205 140L190 161L166 149Z" fill="#7FA899" /><path d="M185 154L185 178" stroke="#526C61" strokeWidth="3" />
      <path d="M358 145L381 140L396 147L373 152L358 145Z" fill="#C9D4C3" /><path d="M358 145V161L373 169L396 163V147L373 152V169" fill="#A9BEA7" />
      <path d="M348 163L365 173L365 228L391 241" stroke="#758E7C" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
      <circle cx="352" cy="60" r="15" fill="#0F9D8A" /><path d="M345 60L350 65L359 55" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

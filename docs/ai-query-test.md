# AI Query Generation Test Cases

AutoPDF AI自然言語 → Gmail検索条件 生成テスト

## Sender + Document

Amazon請求書  
→ from:amazon subject:(請求書)

Googleから届いた見積書PDF  
→ from:google filename:pdf has:attachment

Stripeから届いた請求書  
→ from:stripe subject:(請求書)

## File Type Detection

StripeのCSV明細  
→ from:stripe filename:csv has:attachment

Stripeのエクセル明細  
→ from:stripe filename:xlsx has:attachment

Wordの請求書  
→ filename:docx has:attachment

添付のワード見積書  
→ filename:docx has:attachment

## Image Attachments

添付画像の見積書  
→ filename:jpg has:attachment

jpgの領収書メール  
→ filename:jpg has:attachment

写真付きの請求書  
→ filename:jpg has:attachment

## Subject Explicit Mention

件名に請求書がある未読メール  
→ subject:(請求書) is:unread

件名に領収書があるPDFメール  
→ subject:(領収書) filename:pdf has:attachment

## Time Filter

7日以内のStripe請求書  
→ from:stripe subject:(請求書) newer_than:7d

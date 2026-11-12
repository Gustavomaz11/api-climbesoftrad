import sharp from 'sharp'

export const syntheticSignature = (variant = 1) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="180"><rect width="700" height="180" fill="white"/><path d="M25 95 Q120 10 220 95 T420 95 T650 95" fill="none" stroke="#182638" stroke-width="3"/><text x="80" y="130" font-family="serif" font-size="30" fill="#182638">ASSINATURA DE TESTE ${variant}</text></svg>`)).png().toBuffer()

import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { parseAllowedOrigins } from './config/environment'
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const configService = app.get(ConfigService)
  const allowedOrigins = parseAllowedOrigins(configService.getOrThrow<string>('FRONTEND_ORIGIN'))
  const viewerUrl = configService.get<string>('OHIF_VIEWER_URL')
  const allowedBrowserOrigins = new Set([...allowedOrigins, ...(viewerUrl ? [new URL(viewerUrl).origin] : [])])

  const expressApplication = app.getHttpAdapter().getInstance() as Express
  const isProduction = configService.getOrThrow<string>('NODE_ENV') === 'production'
  const trustedProxyHops = configService.getOrThrow<number>('TRUST_PROXY_HOPS')
  expressApplication.set('trust proxy', trustedProxyHops)
  expressApplication.disable('x-powered-by')
  app.use(
    helmet({
      contentSecurityPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  )
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Pragma', 'no-cache')
    next()
  })
  expressApplication.use('/api/v1/exams', express.json({ limit: '3mb' }))
  app.use(express.json({ limit: '32kb' }))
  app.use(express.urlencoded({ extended: false, limit: '32kb' }))
  app.use(cookieParser())
  app.enableCors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Company-Id',
      'X-Unit-Id',
    ],
    exposedHeaders: [
      'Retry-After',
      'Retry-After-burst',
      'Retry-After-sustained',
      'X-RateLimit-Limit',
      'X-RateLimit-Limit-burst',
      'X-RateLimit-Limit-sustained',
      'X-RateLimit-Remaining',
      'X-RateLimit-Remaining-burst',
      'X-RateLimit-Remaining-sustained',
      'X-RateLimit-Reset',
      'X-RateLimit-Reset-burst',
      'X-RateLimit-Reset-sustained',
    ],
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedBrowserOrigins.has(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origin não permitida pelo CORS'), false)
    },
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  )
  app.setGlobalPrefix('api/v1')
  app.enableShutdownHooks()

  if (configService.getOrThrow<boolean>('SWAGGER_ENABLED')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('HealthCRM API')
      .setDescription('API de autenticação do CRM hospitalar')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig))
  }

  const port = configService.getOrThrow<number>('PORT')
  await app.listen(port, '0.0.0.0')
  const tlsKey = configService.get<string>('ROUTER_TLS_KEY_PATH'), tlsCert = configService.get<string>('ROUTER_TLS_CERT_PATH')
  if (tlsKey && tlsCert) {
    const secureServer = createServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert), minVersion: 'TLSv1.2' }, expressApplication)
    const securePort = configService.get<number>('ROUTER_TLS_PORT') || 3443
    await new Promise<void>((resolve, reject) => { secureServer.once('error', reject); secureServer.listen(securePort, '0.0.0.0', resolve) })
    const httpServer = app.getHttpServer() as Server
    httpServer.once('close', () => secureServer.close())
    Logger.log(`Canal HTTPS do Router disponível na porta ${securePort}`, 'Bootstrap')
  }
  Logger.log(`API disponível na porta ${port}`, 'Bootstrap')
}

void bootstrap()

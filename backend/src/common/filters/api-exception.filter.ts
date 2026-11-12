import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Request, Response } from 'express'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()
    const safePath=request.path.replace(/\/(dicom-viewer|dicom-download)\/[^/]+/g,'/$1/[redacted]')
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Erro não tratado em ${request.method} ${safePath}`,
        exception instanceof Error ? exception.stack : undefined,
      )
    }

    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null
    if(response.headersSent) {response.destroy();return}
    const message = this.resolveMessage(status, exceptionResponse)

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: safePath,
    })
  }

  private resolveMessage(status: number, response: string | object | null): string | string[] {
    if (status === 500) {
      return 'Não foi possível processar a solicitação.'
    }

    if (typeof response === 'string') {
      return response
    }

    if (response && 'message' in response) {
      const message = (response as { message?: unknown }).message
      if (typeof message === 'string' || Array.isArray(message)) {
        return message as string | string[]
      }
    }

    return 'Solicitação inválida.'
  }
}

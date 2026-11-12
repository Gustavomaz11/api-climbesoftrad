import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthenticatedUserService } from './authenticated-user.service'
import { ChangePasswordService } from './change-password.service'
import type { AuthenticatedRequest, RequestMetadata } from './auth.contracts'
import { AuthorizationCodeExchangeService } from './authorization-code-exchange.service'
import { AuthorizationCodeTokenDto } from './dto/authorization-code-token.dto'
import { AuthenticatedUserDto } from './dto/authenticated-user.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { TokenRequestDto } from './dto/token-request.dto'
import { AccessTokenGuard } from './guards/access-token.guard'
import { CookieOriginGuard } from './guards/cookie-origin.guard'
import { LoginService } from './login.service'
import { RefreshCookieService } from './refresh-cookie.service'
import { RefreshSessionService } from './refresh-session.service'
import { RegistrationService } from './registration.service'

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly loginService: LoginService,
    private readonly codeExchange: AuthorizationCodeExchangeService,
    private readonly refreshSessions: RefreshSessionService,
    private readonly refreshCookies: RefreshCookieService,
    private readonly authenticatedUsers: AuthenticatedUserService,
    private readonly passwords: ChangePasswordService,
  ) {}

  @Post('register')
  @Throttle({
    burst: { limit: 5, ttl: 10_000 },
    default: { limit: 5, ttl: 60_000 },
    sustained: { limit: 20, ttl: 900_000 },
  })
  @ApiOperation({ summary: 'Cria uma conta quando o cadastro público está habilitado' })
  @ApiCreatedResponse({ type: AuthenticatedUserDto })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.registration.register(dto, this.requestMetadata(request))
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    burst: { limit: 30, ttl: 10_000 },
    default: { limit: 30, ttl: 60_000 },
    sustained: { limit: 100, ttl: 900_000 },
  })
  @ApiOperation({ summary: 'Valida credenciais e emite authorization code vinculado ao PKCE' })
  @ApiOkResponse({ description: 'Authorization code de uso único, state e expiração' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.loginService.login(dto, this.requestMetadata(request))
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    burst: { limit: 60, ttl: 10_000 },
    default: { limit: 60, ttl: 60_000 },
    sustained: { limit: 500, ttl: 900_000 },
  })
  @UseGuards(CookieOriginGuard)
  @ApiOperation({ summary: 'Troca authorization code ou rotaciona refresh token' })
  @ApiOkResponse({
    description: 'Access token; refresh token é enviado somente por cookie HttpOnly',
  })
  async token(
    @Body() dto: TokenRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      dto.grantType === 'refresh_token' &&
      (dto.authorizationCode !== undefined || dto.codeVerifier !== undefined)
    ) {
      throw new BadRequestException(
        'authorizationCode e codeVerifier não são permitidos para refresh_token.',
      )
    }

    const tokens =
      dto.grantType === 'authorization_code'
        ? await this.exchangeAuthorizationCode(dto, this.requestMetadata(request))
        : await this.rotateRefreshToken(dto.clientId, request, this.requestMetadata(request))

    this.refreshCookies.set(response, tokens.refreshToken, tokens.persistent)
    return {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({
    burst: { limit: 10, ttl: 10_000 },
    default: { limit: 20, ttl: 60_000 },
    sustained: { limit: 100, ttl: 900_000 },
  })
  @UseGuards(CookieOriginGuard)
  @ApiNoContentResponse({ description: 'Sessão revogada e cookie removido' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.refreshSessions.logout(
      this.refreshCookies.read(request),
      this.requestMetadata(request),
    )
    this.refreshCookies.clear(response)
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthenticatedUserDto })
  me(@Req() request: AuthenticatedRequest) {
    return this.authenticatedUsers.getById(
      request.auth.userId,
      request.get('X-Company-Id'),
      request.get('X-Unit-Id'),
    )
  }

  @Put('password')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Altera a senha do usuário autenticado' })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() request: AuthenticatedRequest) {
    await this.passwords.change(request.auth.userId, dto)
    return this.authenticatedUsers.getById(
      request.auth.userId,
      request.get('X-Company-Id'),
      request.get('X-Unit-Id'),
    )
  }

  private exchangeAuthorizationCode(dto: TokenRequestDto, metadata: RequestMetadata) {
    if (!dto.authorizationCode || !dto.codeVerifier) {
      throw new BadRequestException('authorizationCode e codeVerifier são obrigatórios.')
    }

    const exchangeDto: AuthorizationCodeTokenDto = {
      grantType: 'authorization_code',
      clientId: dto.clientId,
      authorizationCode: dto.authorizationCode,
      codeVerifier: dto.codeVerifier,
    }
    return this.codeExchange.exchange(exchangeDto, metadata)
  }

  private rotateRefreshToken(clientId: string, request: Request, metadata: RequestMetadata) {
    const refreshToken = this.refreshCookies.read(request)
    if (!refreshToken) {
      throw new UnauthorizedException('Sessão inválida ou expirada.')
    }

    return this.refreshSessions.refresh(clientId, refreshToken, metadata)
  }

  private requestMetadata(request: Request): RequestMetadata {
    return {
      ipAddress: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    }
  }
}

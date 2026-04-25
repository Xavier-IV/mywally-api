import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('myWally API')
    .setDescription(
      'Family-as-circuit-breaker for at-risk transactions. ' +
        'TNG hackathon backend - guardian approval via push and Twilio voice.',
    )
    .setVersion('0.1')
    .addTag('webhooks', 'Inbound webhooks (TNG, Twilio)')
    .addTag('voice', 'Twilio Programmable Voice flow (TwiML)')
    .addTag('simulator', 'Fake TNG merchant for the demo')
    .addTag('health', 'Liveness probe')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(`mywally-api listening on :${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
}
bootstrap();

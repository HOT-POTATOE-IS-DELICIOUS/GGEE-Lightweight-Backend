import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NewsController } from './news.controller';
import { NewsCrawlerClient } from './news-crawler.client';
import { ReactionService } from './reaction.service';

/**
 * Integration test for the `GET /news` seam: real routing + real global ValidationPipe
 * (whitelist + transform), with NewsCrawlerClient mocked. Verifies the DTO/pipe wiring that
 * unit tests calling NewsCrawlerClient directly (news-crawler.client.spec.ts) never exercise.
 */
describe('NewsController (GET /news)', () => {
  let app: INestApplication;
  let search: jest.Mock;

  beforeEach(async () => {
    search = jest.fn().mockResolvedValue({
      total: 1,
      hits: [{ id: 'a', title: 'T', description: 'D', link: 'L', published_at: 'P' }],
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [NewsController],
      providers: [
        { provide: NewsCrawlerClient, useValue: { search } },
        { provide: ReactionService, useValue: { getNews: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('coerces numeric/enum query params and forwards them to NewsCrawlerClient', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/news')
      .query({ q: '트럼프', size: '20', from: '10', sort: 'date' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: 1,
      hits: [{ id: 'a', title: 'T', description: 'D', link: 'L', published_at: 'P' }],
    });

    expect(search).toHaveBeenCalledTimes(1);
    const query = search.mock.calls[0][0];
    expect(query.q).toBe('트럼프');
    expect(query.size).toBe(20);
    expect(typeof query.size).toBe('number');
    expect(query.from).toBe(10);
    expect(query.sort).toBe('date');
  });

  it('rejects a missing q with 400 and never calls NewsCrawlerClient', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/news')
      .query({});

    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects an invalid sort value with 400', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/news')
      .query({ q: 'x', sort: 'bogus' });

    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('strips unknown query params (whitelist) before reaching NewsCrawlerClient', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/news')
      .query({ q: 'x', evil: 'dropme' });

    expect(res.status).toBe(200);
    const query = search.mock.calls[0][0];
    expect(query.evil).toBeUndefined();
  });

  it('routes GET /news/:node_id to ReactionService, not NewsCrawlerClient', async () => {
    const getNews = jest.fn().mockResolvedValue({ node_id: 'n1', count: 0, news: [] });
    const moduleRef = await Test.createTestingModule({
      controllers: [NewsController],
      providers: [
        { provide: NewsCrawlerClient, useValue: { search } },
        { provide: ReactionService, useValue: { getNews } },
      ],
    }).compile();
    const app2 = moduleRef.createNestApplication();
    app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app2.init();

    const res = await request(app2.getHttpServer() as never).get('/news/n1');

    expect(res.status).toBe(200);
    expect(getNews).toHaveBeenCalledWith('n1');
    expect(search).not.toHaveBeenCalled();

    await app2.close();
  });
});

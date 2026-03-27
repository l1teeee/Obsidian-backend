import { FastifyReply, FastifyRequest } from 'fastify';
import * as postsService from './posts.service';
import type { CreatePostData, UpdatePostData } from './posts.service';

type GetPostsQuery = {
  platform?: 'meta' | 'linkedin' | 'youtube';
  status?:   'draft' | 'scheduled' | 'published' | 'inactive' | 'deleted';
  page:      number;
  limit:     number;
};

type PostIdParam = { id: string };

export async function getPostsHandler(
  request: FastifyRequest<{ Querystring: GetPostsQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { platform, status, page = 1, limit = 20 } = request.query;
  const result = await postsService.getPosts(request.user.id, { platform, status, page, limit });
  reply.send({ success: true, data: result.posts, meta: result.meta });
}

export async function getPostByIdHandler(
  request: FastifyRequest<{ Params: PostIdParam }>,
  reply: FastifyReply
): Promise<void> {
  const post = await postsService.getPostById(request.params.id, request.user.id);
  reply.send({ success: true, data: post });
}

export async function createPostHandler(
  request: FastifyRequest<{ Body: CreatePostData }>,
  reply: FastifyReply
): Promise<void> {
  const post = await postsService.createPost(request.user.id, request.body);
  reply.code(201).send({ success: true, data: post });
}

export async function updatePostHandler(
  request: FastifyRequest<{ Params: PostIdParam; Body: UpdatePostData }>,
  reply: FastifyReply
): Promise<void> {
  const post = await postsService.updatePost(
    request.params.id,
    request.user.id,
    request.body
  );
  reply.send({ success: true, data: post });
}

export async function deactivatePostHandler(
  request: FastifyRequest<{ Params: PostIdParam }>,
  reply: FastifyReply
): Promise<void> {
  const post = await postsService.deactivatePost(request.params.id, request.user.id);
  reply.send({ success: true, data: post });
}

export async function deletePostHandler(
  request: FastifyRequest<{ Params: PostIdParam }>,
  reply: FastifyReply
): Promise<void> {
  await postsService.deletePost(request.params.id, request.user.id);
  reply.send({ success: true, data: null });
}

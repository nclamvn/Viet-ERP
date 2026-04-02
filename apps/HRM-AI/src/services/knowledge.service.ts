// src/services/knowledge.service.ts
// Knowledge Base Service

import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";

export interface KnowledgeFilters {
  category?: string;
  search?: string;
  isPublished?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateKnowledgeInput {
  title: string;
  content: string;
  category: string;
  keywords?: string[];
  isPublished?: boolean;
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  category?: string;
  keywords?: string[];
  isPublished?: boolean;
}

export const knowledgeService = {
  /**
   * Get all knowledge articles with pagination and filters
   */
  async getAll(
    tenantId: string,
    filters: KnowledgeFilters = {},
  ): Promise<PaginatedResponse<Prisma.KnowledgeArticleGetPayload<object>>> {
    const { category, search, isPublished, page = 1, pageSize = 20 } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.KnowledgeArticleWhereInput = {
      tenantId,
      ...(category && { category }),
      ...(isPublished !== undefined && { isPublished }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      db.knowledgeArticle.findMany({
        where,
        orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
        skip,
        take: pageSize,
      }),
      db.knowledgeArticle.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Get published articles for chatbot
   */
  async getPublished(
    tenantId: string,
    category?: string,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object>[]> {
    return db.knowledgeArticle.findMany({
      where: {
        tenantId,
        isPublished: true,
        ...(category && { category }),
      },
      orderBy: { viewCount: "desc" },
    });
  },

  /**
   * Get article by ID
   */
  async getById(
    tenantId: string,
    id: string,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object> | null> {
    return db.knowledgeArticle.findFirst({
      where: { id, tenantId },
    });
  },

  /**
   * Get article and increment view count
   */
  async getByIdWithView(
    tenantId: string,
    id: string,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object> | null> {
    const article = await db.knowledgeArticle.findFirst({
      where: { id, tenantId },
    });

    if (article) {
      await db.knowledgeArticle.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });
    }

    return article;
  },

  /**
   * Search articles by query
   */
  async search(
    tenantId: string,
    query: string,
    limit: number = 5,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object>[]> {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (keywords.length === 0) {
      return [];
    }

    return db.knowledgeArticle.findMany({
      where: {
        tenantId,
        isPublished: true,
        OR: keywords.flatMap((keyword) => [
          { title: { contains: keyword, mode: "insensitive" } },
          { content: { contains: keyword, mode: "insensitive" } },
          { keywords: { has: keyword } },
        ]),
      },
      take: limit,
      orderBy: { viewCount: "desc" },
    });
  },

  /**
   * Get all categories
   */
  async getCategories(tenantId: string): Promise<string[]> {
    const result = await db.knowledgeArticle.findMany({
      where: { tenantId },
      select: { category: true },
      distinct: ["category"],
    });
    return result.map((r) => r.category);
  },

  /**
   * Create a new article
   */
  async create(
    tenantId: string,
    createdBy: string,
    input: CreateKnowledgeInput,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object>> {
    return db.knowledgeArticle.create({
      data: {
        tenantId,
        createdBy,
        title: input.title,
        content: input.content,
        category: input.category,
        keywords: input.keywords || [],
        isPublished: input.isPublished ?? false,
      },
    });
  },

  /**
   * Update an article
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateKnowledgeInput,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object>> {
    const article = await this.getById(tenantId, id);
    if (!article) {
      throw new Error("Bài viết không tồn tại");
    }

    return db.knowledgeArticle.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.keywords !== undefined && { keywords: input.keywords }),
        ...(input.isPublished !== undefined && {
          isPublished: input.isPublished,
        }),
      },
    });
  },

  /**
   * Delete an article
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const article = await this.getById(tenantId, id);
    if (!article) {
      throw new Error("Bài viết không tồn tại");
    }

    await db.knowledgeArticle.delete({ where: { id } });
  },

  /**
   * Toggle publish status
   */
  async togglePublish(
    tenantId: string,
    id: string,
  ): Promise<Prisma.KnowledgeArticleGetPayload<object>> {
    const article = await this.getById(tenantId, id);
    if (!article) {
      throw new Error("Bài viết không tồn tại");
    }

    return db.knowledgeArticle.update({
      where: { id },
      data: { isPublished: !article.isPublished },
    });
  },

  /**
   * Mark article as helpful
   */
  async markHelpful(tenantId: string, id: string): Promise<void> {
    const article = await this.getById(tenantId, id);
    if (!article) {
      throw new Error("Bài viết không tồn tại");
    }

    await db.knowledgeArticle.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    });
  },
};

// src/lib/employee-experience/feed/service.ts
// Company Feed Service - News, Announcements, Events

import { db } from "@/lib/db";
import {
  PostType,
  PostVisibility,
  PostStatus,
  EventType,
  RsvpStatus,
  Prisma,
} from ".prisma/hrm-ai-client";

// Types
export interface CreatePostInput {
  type: PostType;
  title?: string;
  content: string;
  visibility?: PostVisibility;
  targetDepartments?: string[];
  isPinned?: boolean;
  mediaUrls?: string[];
}

export interface FeedFilters {
  types?: PostType[];
  departmentId?: string;
  authorId?: string;
  isPinned?: boolean;
  search?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface FeedResult {
  posts: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unreadCount: number;
}

// Company Feed Service
export class CompanyFeedService {
  constructor(private tenantId: string) {}

  /**
   * Create a new post
   */
  async createPost(authorId: string, input: CreatePostInput) {
    const {
      type,
      title,
      content,
      visibility = PostVisibility.ALL,
      targetDepartments = [],
      isPinned = false,
      mediaUrls = [],
    } = input;

    // Create post
    const post = await db.companyPost.create({
      data: {
        tenantId: this.tenantId,
        authorId,
        type,
        title,
        content,
        visibility,
        targetDepartments,
        isPinned,
        status: PostStatus.PUBLISHED,
        mediaUrls,
        publishedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            comments: true,
            readBy: true,
          },
        },
      },
    });

    return post;
  }

  /**
   * Get feed for an employee
   */
  async getFeed(
    employeeId: string,
    filters: FeedFilters = {},
    pagination: PaginationOptions = {},
  ): Promise<FeedResult> {
    const { page = 1, pageSize = 20 } = pagination;
    const skip = (page - 1) * pageSize;

    // Get employee's department for visibility filtering
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true },
    });

    // Build where clause
    const where: Prisma.CompanyPostWhereInput = {
      tenantId: this.tenantId,
      status: PostStatus.PUBLISHED,
      OR: [
        { visibility: PostVisibility.ALL },
        ...(employee?.departmentId
          ? [
              {
                visibility: PostVisibility.DEPARTMENT,
                targetDepartments: {
                  has: employee.departmentId,
                },
              },
            ]
          : []),
      ],
    };

    // Apply filters
    if (filters.types?.length) {
      where.type = { in: filters.types };
    }

    if (filters.authorId) {
      where.authorId = filters.authorId;
    }

    if (filters.isPinned !== undefined) {
      where.isPinned = filters.isPinned;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { content: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.fromDate) {
      where.publishedAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.publishedAt = {
        ...((where.publishedAt as any) || {}),
        lte: filters.toDate,
      };
    }

    // Get posts with pinned first
    const [posts, total, unreadCount] = await Promise.all([
      db.companyPost.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
        skip,
        take: pageSize,
        include: {
          author: {
            select: {
              id: true,
              fullName: true,
              avatar: true,
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          reactions: {
            select: {
              id: true,
              employeeId: true,
              emoji: true,
            },
          },
          comments: {
            take: 3,
            orderBy: { createdAt: "desc" },
            include: {
              author: {
                select: {
                  id: true,
                  fullName: true,
                  avatar: true,
                },
              },
            },
          },
          readBy: {
            where: { employeeId },
            select: { id: true },
          },
          _count: {
            select: {
              reactions: true,
              comments: true,
              readBy: true,
            },
          },
        },
      }),
      db.companyPost.count({ where }),
      this.getUnreadCount(employeeId),
    ]);

    // Transform posts to include read status
    const transformedPosts = posts.map((post: any) => ({
      ...post,
      isRead: post.readBy.length > 0,
      userReaction: post.reactions.find(
        (r: any) => r.employeeId === employeeId,
      ),
      readBy: undefined,
    }));

    return {
      posts: transformedPosts,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      unreadCount,
    };
  }

  /**
   * Get a single post by ID
   */
  async getPost(postId: string, employeeId?: string) {
    const post = await db.companyPost.findFirst({
      where: {
        id: postId,
        tenantId: this.tenantId,
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        reactions: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                avatar: true,
              },
            },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: {
              select: {
                id: true,
                fullName: true,
                avatar: true,
              },
            },
          },
        },
        _count: {
          select: {
            reactions: true,
            comments: true,
            readBy: true,
          },
        },
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    // Mark as read if employeeId provided
    if (employeeId) {
      await this.markAsRead(postId, employeeId);
    }

    return post;
  }

  /**
   * Add reaction to a post
   */
  async addReaction(postId: string, employeeId: string, emoji: string) {
    // Check for existing reaction
    const existing = await db.postReaction.findUnique({
      where: {
        postId_employeeId: {
          postId,
          employeeId,
        },
      },
    });

    if (existing) {
      if (existing.emoji === emoji) {
        // Remove reaction (toggle off)
        await db.postReaction.delete({
          where: { id: existing.id },
        });
        return { removed: true };
      } else {
        // Update to new emoji
        return db.postReaction.update({
          where: { id: existing.id },
          data: { emoji },
        });
      }
    }

    // Create new reaction
    return db.postReaction.create({
      data: {
        postId,
        employeeId,
        emoji,
      },
    });
  }

  /**
   * Add comment to a post
   */
  async addComment(postId: string, authorId: string, content: string) {
    // Verify post exists and is from same tenant
    const post = await db.companyPost.findFirst({
      where: {
        id: postId,
        tenantId: this.tenantId,
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    return db.postComment.create({
      data: {
        postId,
        authorId,
        content,
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
      },
    });
  }

  /**
   * Mark post as read
   */
  async markAsRead(postId: string, employeeId: string) {
    // Upsert to avoid duplicates
    return db.postRead.upsert({
      where: {
        postId_employeeId: {
          postId,
          employeeId,
        },
      },
      create: {
        postId,
        employeeId,
      },
      update: {
        readAt: new Date(),
      },
    });
  }

  /**
   * Get unread count for an employee
   */
  async getUnreadCount(employeeId: string): Promise<number> {
    // Get employee's department
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true },
    });

    const readPostIds = await db.postRead.findMany({
      where: { employeeId },
      select: { postId: true },
    });

    return db.companyPost.count({
      where: {
        tenantId: this.tenantId,
        status: PostStatus.PUBLISHED,
        id: { notIn: readPostIds.map((r: any) => r.postId) },
        OR: [
          { visibility: PostVisibility.ALL },
          ...(employee?.departmentId
            ? [
                {
                  visibility: PostVisibility.DEPARTMENT,
                  targetDepartments: {
                    has: employee.departmentId,
                  },
                },
              ]
            : []),
        ],
      },
    });
  }

  /**
   * Update a post
   */
  async updatePost(
    postId: string,
    authorId: string,
    updates: Partial<CreatePostInput>,
  ) {
    // Verify ownership
    const post = await db.companyPost.findFirst({
      where: {
        id: postId,
        tenantId: this.tenantId,
        authorId,
      },
    });

    if (!post) {
      throw new Error("Post not found or you are not the author");
    }

    return db.companyPost.update({
      where: { id: postId },
      data: {
        title: updates.title,
        content: updates.content,
        visibility: updates.visibility,
        targetDepartments: updates.targetDepartments,
        isPinned: updates.isPinned,
        mediaUrls: updates.mediaUrls,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete a post (soft delete)
   */
  async deletePost(postId: string, authorId: string, isAdmin: boolean = false) {
    // Verify ownership or admin
    const post = await db.companyPost.findFirst({
      where: {
        id: postId,
        tenantId: this.tenantId,
        ...(isAdmin ? {} : { authorId }),
      },
    });

    if (!post) {
      throw new Error("Post not found or you do not have permission");
    }

    return db.companyPost.update({
      where: { id: postId },
      data: {
        status: PostStatus.ARCHIVED,
      },
    });
  }

  /**
   * RSVP to an event
   */
  async rsvpEvent(eventId: string, employeeId: string, status: RsvpStatus) {
    const event = await db.companyEvent.findFirst({
      where: {
        id: eventId,
        tenantId: this.tenantId,
      },
      include: {
        _count: {
          select: { attendees: true },
        },
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    // Check max attendees for ATTENDING status
    if (
      status === RsvpStatus.ATTENDING &&
      event.maxAttendees &&
      event._count.attendees >= event.maxAttendees
    ) {
      throw new Error("Event is at full capacity");
    }

    // Upsert attendance
    return db.eventAttendee.upsert({
      where: {
        eventId_employeeId: {
          eventId,
          employeeId,
        },
      },
      create: {
        eventId,
        employeeId,
        status,
      },
      update: {
        status,
        respondedAt: new Date(),
      },
    });
  }

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(limit: number = 10) {
    return db.companyEvent.findMany({
      where: {
        tenantId: this.tenantId,
        startDate: { gte: new Date() },
      },
      orderBy: { startDate: "asc" },
      take: limit,
      include: {
        organizer: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        _count: {
          select: { attendees: true },
        },
      },
    });
  }

  /**
   * Get announcements (pinned or important posts)
   */
  async getAnnouncements(limit: number = 5) {
    return db.companyPost.findMany({
      where: {
        tenantId: this.tenantId,
        status: PostStatus.PUBLISHED,
        type: PostType.ANNOUNCEMENT,
      },
      orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
      take: limit,
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            comments: true,
            readBy: true,
          },
        },
      },
    });
  }

  /**
   * Create an event
   */
  async createEvent(
    organizerId: string,
    input: {
      title: string;
      description?: string;
      type: EventType;
      startDate: Date;
      endDate: Date;
      isAllDay?: boolean;
      location?: string;
      isVirtual?: boolean;
      virtualLink?: string;
      maxAttendees?: number;
      requiresRsvp?: boolean;
      rsvpDeadline?: Date;
    },
  ) {
    return db.companyEvent.create({
      data: {
        tenantId: this.tenantId,
        organizerId,
        title: input.title,
        description: input.description,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        isAllDay: input.isAllDay || false,
        location: input.location,
        isVirtual: input.isVirtual || false,
        virtualLink: input.virtualLink,
        maxAttendees: input.maxAttendees,
        requiresRsvp: input.requiresRsvp || false,
        rsvpDeadline: input.rsvpDeadline,
      },
      include: {
        organizer: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });
  }
}

// Factory function
export function createCompanyFeedService(tenantId: string): CompanyFeedService {
  return new CompanyFeedService(tenantId);
}

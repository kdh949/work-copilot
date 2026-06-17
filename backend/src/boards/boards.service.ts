import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { Board } from './entities/board.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Tag } from './entities/tag.entity';
import { AiService } from '../ai/ai.service';

type JwtPayload = {
  sub: number;
  loginId: string;
};

@Injectable()
export class BoardsService {
  constructor(
    // Board는 엔티티 클래스가 들어온다
    @InjectRepository(Board)
    private readonly boardsRepository: Repository<Board>,
    // Tag 테이블을 읽고 쓰기 위한 저장소입니다.
    @InjectRepository(Tag)
    private readonly tagsRepository: Repository<Tag>,
    private readonly jwtService: JwtService,
    private readonly aiService: AiService,
  ) {}

  // 토큰에서 userId와 loginId를 꺼내는 함수입니다.
  private async getUserFromToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('토큰이 유효하지 않습니다.');
    }
  }

  private normalizeTagNames(dto: { tags?: string[]; tag?: string }) {
    // 화면에서는 여러 태그를 배열로 보내고, 예전 코드와 호환하려고 tag 문자열도 받습니다.
    // 중복 태그와 빈 태그를 제거해서 DB에 깔끔하게 저장합니다.
    const rawTags = dto.tags?.length ? dto.tags : dto.tag ? [dto.tag] : [];
    return this.uniqueTagNames(rawTags);
  }

  private getTagKey(tagName: string) {
    return tagName.trim().toLocaleLowerCase();
  }

  private uniqueTagNames(tagNames: string[]) {
    const seen = new Set<string>();

    return tagNames
      .map((tagName) => tagName.trim())
      .filter((tagName) => {
        if (!tagName) {
          return false;
        }

        const key = this.getTagKey(tagName);

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }

  private async findOrCreateTags(tagNames: string[]) {
    // 태그 이름이 이미 있으면 재사용하고, 없으면 새로 만듭니다.
    // 그래서 같은 "알고리즘" 태그를 여러 게시글이 함께 쓸 수 있습니다.
    const tags: Tag[] = [];

    for (const name of tagNames) {
      let tag = await this.tagsRepository
        .createQueryBuilder('tag')
        .where('LOWER(tag.name) = LOWER(:name)', { name })
        .getOne();
      if (!tag) {
        tag = await this.tagsRepository.save(
          this.tagsRepository.create({ name }),
        );
      }
      tags.push(tag);
    }

    return tags;
  }

  private toBoardResponse(board: Board) {
    // 프론트가 쓰기 쉽게 tags 배열을 내려줍니다.
    // tag 문자열은 예전 화면 코드와의 호환용으로 함께 제공합니다.
    const tagNames = this.uniqueTagNames(
      board.tags?.map((tag) => tag.name) ?? [],
    );
    const writer = board.user?.loginId ?? board.writer;

    return {
      id: board.id,
      title: board.title,
      content: board.content,
      userId: board.userId,
      writer,
      viewCount: board.viewCount,
      tags: tagNames,
      tag: tagNames.join(', '),
    };
  }

  private indexBoardInBackground(board: Board) {
    // 게시글 저장 직후 해당 글만 인덱싱합니다. 실패해도 게시글 저장은 유지합니다.
    const tagNames = this.uniqueTagNames(
      board.tags?.map((tag) => tag.name) ?? [],
    );
    const writer = board.user?.loginId ?? board.writer;

    void this.aiService
      .indexBoardDocument({
        id: board.id,
        title: board.title,
        content: board.content,
        writer,
        tags: tagNames,
      })
      .catch((error: unknown) => {
        console.warn(`[board-index] failed: ${String(error)}`);
      });
  }

  async create(createBoardDto: CreateBoardDto, token: string) {
    const user = await this.getUserFromToken(token);
    // 요청으로 받은 태그 이름들을 실제 Tag 엔티티 목록으로 바꿉니다.
    const tags = await this.findOrCreateTags(
      this.normalizeTagNames(createBoardDto),
    );
    const board = this.boardsRepository.create({
      title: createBoardDto.title,
      content: createBoardDto.content,
      // 작성자는 클라이언트 body가 아니라 검증된 JWT payload에서만 정합니다.
      userId: user.sub,
      writer: user.loginId,
      tags,
    });
    const saved = await this.boardsRepository.save(board);
    this.indexBoardInBackground(saved);
    return this.toBoardResponse(saved);
  }

  async findAll(page: number, limit: number, keyword: string) {
    /*
    page=1, limit=10 -> skip=0
    page=2, limit=10 -> skip=10
    page=3, limit=10 -> skip=20
    */
    const skip = (page - 1) * limit;

    const query = this.boardsRepository
      .createQueryBuilder('board')
      // 게시글을 가져올 때 연결된 태그도 같이 가져옵니다.
      .leftJoinAndSelect('board.tags', 'tag')
      .leftJoinAndSelect('board.user', 'user')
      .orderBy('board.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (keyword) {
      // 제목, 내용, 태그 이름 중 하나라도 검색어를 포함하면 목록에 보여줍니다.
      query.where(
        'board.title LIKE :keyword OR board.content LIKE :keyword OR tag.name LIKE :keyword',
        { keyword: `%${keyword}%` },
      );
    }

    const [items, total] = await query.getManyAndCount();

    return {
      items: items.map((board) => this.toBoardResponse(board)),
      total,
      page,
      limit,
    };
  }

  async findMine(token: string) {
    const user = await this.getUserFromToken(token);
    const boards = await this.boardsRepository.find({
      where: [{ userId: user.sub }, { writer: user.loginId }],
      relations: { tags: true, user: true },
      order: { id: 'DESC' },
      take: 50,
    });

    return boards.map((board) => this.toBoardResponse(board));
  }

  async findOne(id: number) {
    const board = await this.boardsRepository.findOne({
      where: { id },
      // 상세 화면에서도 태그 이름을 보여줘야 해서 tags 관계를 같이 가져옵니다.
      relations: { tags: true, user: true },
    });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    await this.addViewCount(id);

    return {
      ...this.toBoardResponse(board),
      viewCount: board.viewCount + 1,
    };
  }

  async update(id: number, updateBoardDto: UpdateBoardDto, token: string) {
    const user = await this.getUserFromToken(token);
    const board = await this.boardsRepository.findOne({
      where: { id },
      // 수정할 때 기존 태그를 새 태그 목록으로 바꾸기 위해 같이 가져옵니다.
      relations: { tags: true, user: true },
    });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    if (board.userId !== user.sub && board.writer !== user.loginId) {
      throw new ForbiddenException('작성자만 수정할 수 있습니다.');
    }

    if (updateBoardDto.title !== undefined) {
      board.title = updateBoardDto.title;
    }
    if (updateBoardDto.content !== undefined) {
      board.content = updateBoardDto.content;
    }
    if (updateBoardDto.tags !== undefined || updateBoardDto.tag !== undefined) {
      // 수정 요청에 태그가 있으면 게시글의 태그 목록을 통째로 새로 맞춥니다.
      board.tags = await this.findOrCreateTags(
        this.normalizeTagNames(updateBoardDto),
      );
    }

    const saved = await this.boardsRepository.save(board);
    this.indexBoardInBackground(saved);
    return this.toBoardResponse(saved);
  }

  async remove(id: number, token: string) {
    const user = await this.getUserFromToken(token);
    const board = await this.boardsRepository.findOne({
      where: { id },
      relations: { user: true },
    });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    if (board.userId !== user.sub && board.writer !== user.loginId) {
      throw new ForbiddenException('작성자만 삭제할 수 있습니다.');
    }

    return this.boardsRepository.delete({ id });
  }

  addViewCount(id: number) {
    return this.boardsRepository.increment({ id }, 'viewCount', 1);
  }

  async findTags() {
    // 글쓰기 화면에서 선택지로 보여줄 전체 태그 목록입니다.
    const tags = await this.tagsRepository.find({
      order: { name: 'ASC' },
    });
    return this.uniqueTagNames(tags.map((tag) => tag.name));
  }

  async findPopularTags() {
    const rows = await this.tagsRepository
      .createQueryBuilder('tag')
      .leftJoin('tag.boards', 'board')
      .select('MIN(tag.name)', 'name')
      .addSelect('COUNT(board.id)', 'count')
      .groupBy('LOWER(tag.name)')
      .orderBy('COUNT(board.id)', 'DESC')
      .addOrderBy('MIN(tag.name)', 'ASC')
      .limit(5)
      .getRawMany<{ name: string; count: string }>();

    return rows.map((row) => ({
      name: row.name,
      count: Number(row.count),
    }));
  }
}

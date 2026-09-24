"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Heart,
  MessageCircle,
  Eye,
  Users,
  Image as ImageIcon,
  Send,
  Trash2,
  X,
  Clock,
} from "lucide-react";
import { formatDateTime } from "@/lib/finance";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ConfectionerChannelTab({ confectionerId }: { confectionerId: string }) {
  const channelPosts = useAppStore((s) => s.channelPosts);
  const channelStories = useAppStore((s) => s.channelStories);
  const channelFollowers = useAppStore((s) => s.channelFollowers);
  const togglePostLike = useAppStore((s) => s.togglePostLike);
  const addPostComment = useAppStore((s) => s.addPostComment);
  const toggleCommentLike = useAppStore((s) => s.toggleCommentLike);
  const viewStory = useAppStore((s) => s.viewStory);
  const user = useAppStore((s) => s.user);

  const [showCreatePost, setShowCreatePost] = useState(false);
  const [newPostImage, setNewPostImage] = useState("");
  const [newPostCaption, setNewPostCaption] = useState("");
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [viewingStory, setViewingStory] = useState<string | null>(null);

  const myPosts = channelPosts.filter((p) => p.confectionerId === confectionerId);
  const myStories = channelStories.filter((s) => s.confectionerId === confectionerId);
  const myFollowers = channelFollowers.filter((f) => f.confectionerId === confectionerId);
  const totalLikes = myPosts.reduce((s, p) => s + p.likes, 0);
  const totalComments = myPosts.reduce((s, p) => s + p.comments, 0);
  const totalViews = myStories.reduce((s, st) => s + st.views, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Социальный канал</h1>
          <p className="text-sm text-muted-foreground">Посты, сторис, подписчики — как в Instagram</p>
        </div>
        <Button onClick={() => setShowCreatePost(true)}>
          <Plus className="h-4 w-4 mr-1" /> Новый пост
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <Users className="h-5 w-5 text-primary mb-1" />
          <div className="font-display text-xl font-bold">{myFollowers.length}</div>
          <div className="text-xs text-muted-foreground">подписчиков</div>
        </Card>
        <Card className="p-3">
          <Heart className="h-5 w-5 text-rose-600 mb-1" />
          <div className="font-display text-xl font-bold">{totalLikes}</div>
          <div className="text-xs text-muted-foreground">лайков</div>
        </Card>
        <Card className="p-3">
          <MessageCircle className="h-5 w-5 text-blue-600 mb-1" />
          <div className="font-display text-xl font-bold">{totalComments}</div>
          <div className="text-xs text-muted-foreground">комментариев</div>
        </Card>
        <Card className="p-3">
          <Eye className="h-5 w-5 text-purple-600 mb-1" />
          <div className="font-display text-xl font-bold">{totalViews}</div>
          <div className="text-xs text-muted-foreground">просмотров сторис</div>
        </Card>
      </div>

      {/* Stories */}
      {myStories.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Сторис (исчезают через 24ч)
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {myStories.map((story) => (
              <div
                key={story.id}
                onClick={() => {
                  viewStory(story.id);
                  setViewingStory(story.id);
                }}
                className="shrink-0 cursor-pointer group"
              >
                <div className={cn(
                  "h-20 w-20 rounded-full p-0.5",
                  story.viewed ? "bg-border" : "bg-gradient-to-tr from-amber-400 to-rose-500"
                )}>
                  <div className="h-full w-full rounded-full overflow-hidden border-2 border-card">
                    <img src={story.image} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                </div>
                <div className="text-[10px] text-center mt-1 text-muted-foreground">
                  {story.views} просм.
                </div>
              </div>
            ))}
            <button
              onClick={() => toast.info("Создание сторис")}
              className="shrink-0 h-20 w-20 rounded-full border-2 border-dashed border-border flex items-center justify-center hover:border-primary hover:bg-accent transition-colors"
            >
              <Plus className="h-6 w-6 text-muted-foreground" />
            </button>
          </div>
        </Card>
      )}

      {/* Followers */}
      {myFollowers.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Подписчики ({myFollowers.length})
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {myFollowers.map((f) => (
              <div key={f.id} className="shrink-0 text-center">
                <Avatar className="h-12 w-12 mx-auto">
                  <AvatarImage src={f.userAvatar} alt={f.userName} />
                  <AvatarFallback className="text-xs">{f.userName[0]}</AvatarFallback>
                </Avatar>
                <div className="text-[10px] mt-1 max-w-[60px] truncate">{f.userName}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Posts */}
      <div>
        <h3 className="font-semibold text-sm mb-3">Посты ({myPosts.length})</h3>
        <div className="space-y-3">
          {myPosts.map((post) => {
            const isExpanded = expandedPost === post.id;
            return (
              <Card key={post.id} className="overflow-hidden p-0">
                {/* Image */}
                <div className="relative aspect-video bg-muted">
                  <img src={post.image} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
                {/* Content */}
                <div className="p-3 space-y-2">
                  <p className="text-sm">{post.caption}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <button
                      onClick={() => togglePostLike(post.id)}
                      className="flex items-center gap-1 hover:text-rose-600 transition-colors"
                    >
                      <Heart className={cn("h-4 w-4", post.liked && "fill-rose-500 text-rose-500")} />
                      {post.likes}
                    </button>
                    <button
                      onClick={() => setExpandedPost(isExpanded ? null : post.id)}
                      className="flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {post.comments}
                    </button>
                    <span className="ml-auto">{formatDateTime(post.createdAt)}</span>
                  </div>

                  {/* Comments */}
                  {isExpanded && (
                    <div className="pt-2 border-t space-y-2">
                      {post.postComments?.map((comment) => (
                        <div key={comment.id} className="flex items-start gap-2">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage src={comment.userAvatar} alt={comment.userName} />
                            <AvatarFallback className="text-[10px]">{comment.userName[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs">
                              <span className="font-medium">{comment.userName}</span>
                              <span className="text-muted-foreground ml-1">{comment.text}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <button
                                onClick={() => toggleCommentLike(comment.id)}
                                className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-rose-600"
                              >
                                <Heart className={cn("h-2.5 w-2.5", comment.liked && "fill-rose-500 text-rose-500")} />
                                {comment.likes > 0 && comment.likes}
                              </button>
                              <span className="text-[10px] text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {/* Add comment */}
                      <div className="flex gap-2 pt-1">
                        <Input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Комментарий..."
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && commentText.trim()) {
                              addPostComment(post.id, commentText);
                              setCommentText("");
                              toast.success("Комментарий добавлен");
                            }
                          }}
                        />
                        <Button
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={!commentText.trim()}
                          onClick={() => {
                            addPostComment(post.id, commentText);
                            setCommentText("");
                            toast.success("Комментарий добавлен");
                          }}
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Create post dialog */}
      {showCreatePost && (
        <Dialog open onOpenChange={setShowCreatePost}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Новый пост</DialogTitle>
              <DialogDescription>Поделитесь своей работой с подписчиками</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">URL изображения</label>
                <Input value={newPostImage} onChange={(e) => setNewPostImage(e.target.value)} placeholder="https://..." />
              </div>
              {newPostImage && (
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <img src={newPostImage} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
              )}
              <div>
                <label className="text-sm font-medium">Описание</label>
                <Textarea value={newPostCaption} onChange={(e) => setNewPostCaption(e.target.value)} placeholder="Сегодня испекла..." rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreatePost(false)}>Отмена</Button>
              <Button
                disabled={!newPostImage || !newPostCaption}
                onClick={() => {
                  toast.success("Пост опубликован!");
                  setShowCreatePost(false);
                  setNewPostImage("");
                  setNewPostCaption("");
                }}
              >Опубликовать</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Story viewer */}
      {viewingStory && (
        <Dialog open onOpenChange={() => setViewingStory(null)}>
          <DialogContent className="max-w-md p-0 overflow-hidden">
            <div className="relative aspect-[9/16] bg-black">
              <img
                src={myStories.find((s) => s.id === viewingStory)?.image}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute top-3 left-3 right-3">
                <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                  <div className="h-full bg-white" style={{ width: "100%", animation: "shrink-bar 5s linear forwards" }} />
                </div>
              </div>
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <div className="text-sm font-medium">{myStories.find((s) => s.id === viewingStory)?.caption}</div>
                <div className="text-xs opacity-80 mt-1">{myStories.find((s) => s.id === viewingStory)?.views} просмотров</div>
              </div>
              <button
                onClick={() => setViewingStory(null)}
                className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

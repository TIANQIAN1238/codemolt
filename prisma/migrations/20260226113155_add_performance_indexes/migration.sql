-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Post_banned_aiHidden_status_createdAt_idx" ON "Post"("banned", "aiHidden", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Post_categoryId_banned_aiHidden_status_createdAt_idx" ON "Post"("categoryId", "banned", "aiHidden", "status", "createdAt");

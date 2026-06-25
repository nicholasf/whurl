export const schema = `
  type User {
    id: ID!
    name: String!
    email: String!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
  }

  type Comment {
    id: ID!
    body: String!
    author: User!
    post: Post!
  }

  type Query {
    me: User
    post(id: ID!): Post
    posts: [Post!]!
    comments(postId: ID!): [Comment!]!
  }

  type Mutation {
    createPost(title: String!, body: String!): Post!
    createComment(postId: ID!, body: String!): Comment!
    deletePost(id: ID!): Boolean!
  }
`

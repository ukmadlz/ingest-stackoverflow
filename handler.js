'use strict';

const AWS = require('aws-sdk');
const Parser = require('rss-parser');

/**
 * Returns the value of the RSS Feed
 * @param feed URL to the RSS Feed
 * @returns Promise<Object> An object representation of the RSS
 */
const rssContent = async (feed) => {
  const parser = new Parser({
    customFields: {
      item: ['summary']
    }
  });
  return new Promise((resolve, reject) => {
    parser.parseURL(feed, (err, feed) => {
      if (err) return reject(err);
      resolve(feed);
    });
  });
}

const DynamoDB = new AWS.DynamoDB({
  region: 'localhost',
  endpoint: 'http://localhost:8000',
  accessKeyId: 'DEFAULT_ACCESS_KEY',  // needed if you don't have aws credentials at all in env
  secretAccessKey: 'DEFAULT_SECRET' // needed if you don't have aws credentials at all in env
});

// The SO Tag
const tag = 'elk';

module.exports.hello = async event => {

  const questionsFeed = `https://stackoverflow.com/feeds/tag?tagnames=${tag}&sort=newest`;
  
  const questionsData = await rssContent(questionsFeed);

  const completeResult = await Promise.all(questionsData.items.map(async (questionObject) => {
    const { id } = questionObject;
    const numericId = id.split('/').pop();
    const questionFeed = `https://stackoverflow.com/feeds/question/${numericId}`;
    const questionData = await rssContent(questionFeed);
    const { title, summary, link, pubDate, author } = questionData.items.find((questionOrAnswer) => {
      return !questionOrAnswer.title.startsWith('Answer by ');
    });
    const theAnswers = questionData.items.filter((questionOrAnswer) => {
      return questionOrAnswer.title.startsWith('Answer by ');
    });
    return {
      title,
      summary,
      link,
      pubDate,
      author,
      answers: theAnswers
    }
  }));

  Promise.all(completeResult.map(async (questionRecord) => {
    return DynamoDB.putItem({
      Item: questionRecord,
      TableName: `StackOverflow_${tag}`,
    }).promise()
  }));

  return {
    message: 'YUS!',
    event
  };
};
